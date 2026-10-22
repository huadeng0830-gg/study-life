package com.sanliangshi.study.life;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 自更新插件必须在 super.onCreate() 之前登记：
        // BridgeActivity 的 onCreate 末尾就会创建 Bridge 并加载插件，
        // 那之后再登记就来不及了。
        registerPlugin(ApkUpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
