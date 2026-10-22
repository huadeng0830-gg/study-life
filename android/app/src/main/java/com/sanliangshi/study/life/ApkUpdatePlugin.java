package com.sanliangshi.study.life;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import javax.net.ssl.HttpsURLConnection;

/**
 * 安卓安装包的自更新：下载新的 APK 并交给系统安装器。
 *
 * 【为什么必须原生做】
 *  - 下载：APK 约 8MB，走 JS 的 base64 中转会在 WebView 里堆出十几 MB 的字符串，
 *    低内存机上很容易被系统回收。原生这边直接落盘，不进 JS 内存。
 *  - 安装：系统安装器只认 content:// 的 FileProvider URI，普通链接打不开它，
 *    所以必须由原生发起 Intent。
 *
 * 【安全边界】
 *  - 只接受 https，且主机必须是 github.com 或 GitHub 的下载 CDN
 *    （objects.githubusercontent.com）；其余一律拒绝。
 *  - 落到应用私有缓存目录，文件名由调用方给定且在此处净化，
 *    不接受任何路径分隔符，避免写到目录之外。
 *  - 安装的是"同一个包名、同一签名"的新包才会被系统当成升级；
 *    签名不同系统会拒绝，这与本应用"不要卸载、只覆盖安装"的约定一致。
 */
@CapacitorPlugin(name = "ApkUpdate")
public class ApkUpdatePlugin extends Plugin {

    private static final String UPDATE_DIR = "updates";
    private static final String MIME_APK = "application/vnd.android.package-archive";
    private static final int MAX_APK_BYTES = 256 * 1024 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 30000;
    private static final String EVENT_PROGRESS = "progress";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile Future<?> running;

    /** 只允许 GitHub 官方域名，避免把安装器指向任意来源。 */
    private static boolean isTrustedDownloadUrl(String value) {
        if (value == null || value.length() > 2048) return false;
        try {
            URL url = new URL(value);
            if (!"https".equalsIgnoreCase(url.getProtocol())) return false;
            String host = url.getHost();
            if (host == null) return false;
            String lower = host.toLowerCase();
            return lower.equals("github.com")
                || lower.endsWith(".github.com")
                || lower.equals("objects.githubusercontent.com")
                || lower.endsWith(".objects.githubusercontent.com");
        } catch (Exception error) {
            return false;
        }
    }

    /** 文件名净化：只留字母数字与少量符号，杜绝路径穿越。 */
    private static String safeFileName(String value) {
        String raw = value == null ? "" : value;
        String cleaned = raw.replaceAll("[^A-Za-z0-9._-]", "_");
        if (cleaned.isEmpty()) cleaned = "update.apk";
        if (!cleaned.toLowerCase().endsWith(".apk")) cleaned = cleaned + ".apk";
        return cleaned.length() > 120 ? cleaned.substring(cleaned.length() - 120) : cleaned;
    }

    private File updateFile(String fileName) {
        File dir = new File(getContext().getCacheDir(), UPDATE_DIR);
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, safeFileName(fileName));
    }

    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url", "");
        final String fileName = call.getString("fileName", "update.apk");
        if (!isTrustedDownloadUrl(url)) {
            call.reject("下载地址不可信，已拒绝下载。", "UNTRUSTED_URL");
            return;
        }
        if (running != null && !running.isDone()) {
            call.reject("已有下载在进行中。", "BUSY");
            return;
        }
        final File target = updateFile(fileName);
        call.setKeepAlive(true);
        running = executor.submit(() -> {
            try {
                downloadTo(url, target);
                JSObject result = new JSObject();
                result.put("path", target.getAbsolutePath());
                result.put("fileName", target.getName());
                result.put("bytes", target.length());
                getBridge().executeOnMainThread(() -> call.resolve(result));
            } catch (Exception error) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
                String message = error.getMessage() == null ? "下载失败" : error.getMessage();
                getBridge().executeOnMainThread(() -> call.reject(message, "DOWNLOAD_FAILED"));
            }
        });
    }

    private void downloadTo(String url, File target) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream");
            connection.setRequestProperty("User-Agent", "StudyLife-Android-Updater");
            if (connection instanceof HttpsURLConnection) {
                // 系统信任链由平台负责，这里不关闭校验。
                ((HttpsURLConnection) connection).setHostnameVerifier(HttpsURLConnection.getDefaultHostnameVerifier());
            }
            connection.connect();
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IOException("服务器返回 " + status);
            long total = connection.getContentLengthLong();
            if (total > MAX_APK_BYTES) throw new IOException("安装包体积异常");
            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                long received = 0;
                int read;
                long lastNotify = 0;
                while ((read = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new IOException("下载已取消");
                    output.write(buffer, 0, read);
                    received += read;
                    if (received > MAX_APK_BYTES) throw new IOException("安装包体积异常");
                    long now = System.currentTimeMillis();
                    if (now - lastNotify > 300) {
                        lastNotify = now;
                        JSObject progress = new JSObject();
                        progress.put("received", received);
                        progress.put("total", total > 0 ? total : 0);
                        notifyListeners(EVENT_PROGRESS, progress);
                    }
                }
                output.flush();
            }
        } finally {
            connection.disconnect();
        }
        if (!target.exists() || target.length() <= 0) throw new IOException("下载内容为空");
        // APK 是 zip 包，magic 必须是 "PK"；对不上说明拿到的不是安装包。
        try (InputStream input = new java.io.FileInputStream(target)) {
            byte[] magic = new byte[2];
            if (input.read(magic) != 2 || magic[0] != 'P' || magic[1] != 'K') {
                throw new IOException("下载到的不是有效的安装包");
            }
        }
    }

    @PluginMethod
    public void install(PluginCall call) {
        final String fileName = call.getString("fileName", "update.apk");
        final File target = updateFile(fileName);
        if (!target.exists() || target.length() <= 0) {
            call.reject("安装包不存在，请先下载。", "MISSING_FILE");
            return;
        }
        if (!canRequestPackageInstalls()) {
            call.reject("尚未获得「安装未知应用」的许可。", "PERMISSION_REQUIRED");
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", target);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, MIME_APK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("无法打开系统安装界面：" + (error.getMessage() == null ? "未知错误" : error.getMessage()), "INSTALL_FAILED");
        }
    }

    /** 系统是否已经允许本应用"安装未知应用"。 */
    private boolean canRequestPackageInstalls() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        try {
            return getContext().getPackageManager().canRequestPackageInstalls();
        } catch (Exception error) {
            return false;
        }
    }

    @PluginMethod
    public void canInstallPackages(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", canRequestPackageInstalls());
        call.resolve(result);
    }

    /** 跳到系统设置里的"安装未知应用"授权页。 */
    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("无法打开系统授权页，请到「设置 → 应用 → 特殊权限」里手动允许。", "SETTINGS_FAILED");
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Future<?> current = running;
        if (current != null) current.cancel(true);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        Future<?> current = running;
        if (current != null) current.cancel(true);
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
