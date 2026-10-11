<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Transaction } from '../../types/domain'
import Modal from '../../components/Modal.vue'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Checkbox } from '../../components/ui/checkbox'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../../components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { activeCategories, expenses, isValidDateKey, normalizeAmount, normalizeLedgerTime } from '../../composables/ledger.js'
import { parseBillFile } from '../../composables/ledgerBillImport.js'
import { moneyWithCurrency } from '../../utils/formatters.js'

type ParsedBillFile = Awaited<ReturnType<typeof parseBillFile>>
type BillPreviewRow = Omit<ParsedBillFile['rows'][number], 'amount'> & {
  amount: string
  selected: boolean
}
type ImportDirection = 'expense' | 'income' | 'refund'
type UploadFile = { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }
type FileInputElement = { files: ArrayLike<UploadFile> | null; value: string; click: () => void }

const props = defineProps<{
  open: boolean
  baseCurrency: string
  accountOptions: string[]
  createImportedTransactions: (rows: Transaction[]) => { created: Array<{ id: string }>; skippedDuplicates: number }
}>()
const emit = defineEmits<{
  close: []
  complete: [result: { source: string; count: number; duplicates: number }]
}>()

const PAGE_SIZE = 40
const MAX_FILE_BYTES = 25 * 1024 * 1024
const fileInput = ref<FileInputElement | null>(null)
const fileName = ref('')
const parsed = ref<ParsedBillFile | null>(null)
const rows = ref<BillPreviewRow[]>([])
const page = ref(1)
const busy = ref(false)
const error = ref('')

const pageCount = computed(() => Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE)))
const visibleRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
const selectedRows = computed(() => rows.value.filter((row) => row.selected))
const invalidSelectedRows = computed(() => selectedRows.value.filter((row) => rowIssue(row)))
const validSelectedRows = computed(() => selectedRows.value.filter((row) => !rowIssue(row)))
const allSelected = computed(() => rows.value.length > 0 && selectedRows.value.length === rows.value.length)
const selectionState = computed(() => allSelected.value ? true : selectedRows.value.length ? 'indeterminate' : false)
const canImport = computed(() => !busy.value && !parsed.value?.truncated && validSelectedRows.value.length > 0 && invalidSelectedRows.value.length === 0)
const sourceLabel = computed(() => parsed.value?.source === 'wechat' ? '微信支付' : parsed.value?.source === 'alipay' ? '支付宝' : '')
const accountChoices = computed(() => [...new Set([
  ...props.accountOptions.map((account) => String(account ?? '').trim()),
  sourceLabel.value,
].filter(Boolean))])
const visibleStart = computed(() => rows.value.length ? (page.value - 1) * PAGE_SIZE + 1 : 0)
const visibleEnd = computed(() => Math.min(page.value * PAGE_SIZE, rows.value.length))
const selectedTotals = computed(() => validSelectedRows.value.reduce((total, row) => {
  const amount = normalizeAmount(row.amount) || 0
  if (row.direction === 'income') total.income += amount
  else if (row.direction === 'refund') total.refund += amount
  else total.expense += amount
  return total
}, { expense: 0, income: 0, refund: 0 }))

function categoryChoices(row: BillPreviewRow) {
  const scope = row.direction === 'income' ? 'income' : 'expense'
  return activeCategories(scope)
}

function categoryForDirection(categoryKey: string | undefined, direction: ImportDirection) {
  const choices = activeCategories(direction === 'income' ? 'income' : 'expense')
  if (categoryKey && choices.some((category) => category.key === categoryKey)) return categoryKey
  const fallback = direction === 'income' ? 'other-income' : 'other'
  return choices.find((category) => category.key === fallback)?.key || choices[0]?.key || ''
}

function rowIssue(row: BillPreviewRow) {
  if (!String(row.name ?? '').trim()) return '请补充记录名称'
  const amount = normalizeAmount(row.amount)
  if (amount === null || amount <= 0) return '金额必须大于 0，最多保留两位小数'
  if (!isValidDateKey(row.date)) return '请选择有效日期'
  if (row.time && normalizeLedgerTime(row.time) === null) return '时间格式不正确'
  if (!accountChoices.value.includes(String(row.account ?? '').trim())) return '请选择有效账户'
  if (!['expense', 'income', 'refund'].includes(row.direction)) return '请选择收支类型'
  if (!categoryChoices(row).some((category) => category.key === row.cat)) return '请选择有效分类'
  return ''
}

function setAllSelected(value: boolean) {
  const selected = value === true
  for (const row of rows.value) row.selected = selected
}

function setDirection(row: BillPreviewRow, value: unknown) {
  if (typeof value !== 'string' || (value !== 'expense' && value !== 'income' && value !== 'refund')) return
  row.direction = value
  row.cat = categoryForDirection(row.cat ?? '', value)
}

function existingSourceKeys() {
  const storedTransactions = expenses.value as Transaction[]
  return storedTransactions.flatMap((item) => {
    if ((item.sourceType !== 'wechat-bill' && item.sourceType !== 'alipay-bill') || !item.sourceId) return []
    return [`${item.sourceType}:${item.sourceId}`]
  })
}

async function onFileChange(event: Event) {
  const target = event.currentTarget
  if (!target || !('files' in target) || !('value' in target) || !('click' in target) || typeof target.click !== 'function') return
  const input = target as FileInputElement
  const file = input.files?.[0]
  if (!file) return
  error.value = ''
  parsed.value = null
  rows.value = []
  fileName.value = ''
  page.value = 1

  if (!/\.csv$/i.test(file.name)) {
    error.value = '请选择微信支付或支付宝导出的 CSV 文件。'
    input.value = ''
    return
  }
  if (file.size > MAX_FILE_BYTES) {
    error.value = '文件超过 25 MB。请按月份拆分账单后再导入。'
    input.value = ''
    return
  }

  busy.value = true
  try {
    const result = await parseBillFile(await file.arrayBuffer(), { existingKeys: existingSourceKeys() })
    if (result.source === 'unknown') {
      error.value = '没有识别到微信支付或支付宝账单表头。请确认选择的是平台导出的原始 CSV。'
      return
    }
    parsed.value = result
    fileName.value = file.name
    rows.value = result.rows.map((row) => ({
      ...row,
      selected: true,
      amount: String(row.amount),
      cat: categoryForDirection(row.cat, row.direction),
    }))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取账单失败，请换一个 CSV 文件重试。'
  } finally {
    busy.value = false
    input.value = ''
  }
}

function reset() {
  fileName.value = ''
  parsed.value = null
  rows.value = []
  page.value = 1
  busy.value = false
  error.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

function close() {
  reset()
  emit('close')
}

function confirmImport() {
  if (!canImport.value) return
  busy.value = true
  error.value = ''
  try {
    const importedTransactions: Transaction[] = validSelectedRows.value.map((row) => {
      const amount = normalizeAmount(row.amount)
      if (amount === null) throw new Error('所选记录的金额需要修正后才能导入。')
      return {
        id: '',
        name: row.name,
        amount,
        date: row.date,
        time: normalizeLedgerTime(row.time) ?? undefined,
        direction: row.direction,
        cat: row.cat,
        account: row.account,
        note: row.note,
        source: row.source,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        currency: 'CNY',
        createdFrom: 'import',
      }
    })
    const result = props.createImportedTransactions(importedTransactions)
    emit('complete', {
      source: sourceLabel.value,
      count: result.created.length,
      duplicates: (parsed.value?.skipped?.duplicates || 0) + result.skippedDuplicates,
    })
    close()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '导入失败，尚未写入任何记录。'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Modal v-if="open" :open="open" title="导入账单" wide @close="close">
    <div class="transaction-import">
      <FieldGroup class="transaction-import-file">
        <Field>
          <FieldLabel for="ledger-import-file">选择账单文件</FieldLabel>
          <FieldDescription>支持微信支付与支付宝 CSV。导入前可逐笔核对并修改名称、日期、金额、收支类型、分类和账户。</FieldDescription>
          <input
            id="ledger-import-file"
            ref="fileInput"
            class="sr-only"
            type="file"
            accept=".csv,text/csv"
            aria-label="选择微信支付或支付宝 CSV 账单"
            @change="onFileChange"
          />
          <div class="transaction-import-file-actions">
            <Button type="button" variant="outline" :disabled="busy" @click="fileInput?.click()">
              {{ busy ? '正在读取…' : fileName ? '换一个 CSV 文件' : '选择 CSV 文件' }}
            </Button>
            <Badge v-if="sourceLabel" variant="secondary">{{ sourceLabel }}</Badge>
            <span v-if="fileName" class="transaction-import-filename">{{ fileName }}</span>
          </div>
        </Field>
      </FieldGroup>

      <Alert v-if="error" variant="destructive" role="alert">
        <AlertTitle>暂时无法导入</AlertTitle>
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <template v-if="parsed">
        <Alert v-if="parsed.truncated" variant="destructive" role="alert">
          <AlertTitle>文件行数过多</AlertTitle>
          <AlertDescription>单次最多导入 20,000 条明细。请按月份拆分文件，避免只导入部分流水。</AlertDescription>
        </Alert>

        <Alert v-if="baseCurrency !== 'CNY'" role="status">
          <AlertTitle>账单金额按人民币保存</AlertTitle>
          <AlertDescription>当前汇总币种为 {{ baseCurrency }}。如果尚未设置 CNY 汇率，相关记录会保留在明细中，并明确标记为未折算。</AlertDescription>
        </Alert>

        <Card class="transaction-import-summary">
          <CardHeader class="transaction-import-summary-header">
            <CardTitle>导入预览</CardTitle>
            <CardDescription>确认前可修改每一笔。已识别的转账、中性流水和重复记录不会再次写入。</CardDescription>
          </CardHeader>
          <CardContent class="transaction-import-summary-content">
            <div class="transaction-import-counts" aria-live="polite">
              <div><span>可选记录</span><strong>{{ rows.length }}</strong></div>
              <div><span>当前选择</span><strong>{{ selectedRows.length }}</strong></div>
              <div><span>跳过转账</span><strong>{{ parsed.skipped.transfers }}</strong></div>
              <div><span>重复记录</span><strong>{{ parsed.skipped.duplicates }}</strong></div>
            </div>
            <div class="transaction-import-totals">
              <span>已选支出 {{ moneyWithCurrency(selectedTotals.expense, 'CNY') }}</span>
              <span>收入 {{ moneyWithCurrency(selectedTotals.income, 'CNY') }}</span>
              <span>退款 {{ moneyWithCurrency(selectedTotals.refund, 'CNY') }}</span>
            </div>
          </CardContent>
        </Card>

        <Alert v-if="parsed.skipped.unknown || parsed.skipped.invalid">
          <AlertTitle>部分流水未进入预览</AlertTitle>
          <AlertDescription>
            {{ parsed.skipped.unknown }} 条方向无法识别，{{ parsed.skipped.invalid }} 条日期或金额无效。原文件不会被修改；请在平台重新导出，或手动补记这些流水。
          </AlertDescription>
        </Alert>

        <div v-if="rows.length" class="transaction-import-preview">
          <div class="transaction-import-preview-head">
            <p>预览第 {{ visibleStart }}–{{ visibleEnd }} 条，共 {{ rows.length }} 条</p>
            <div class="transaction-import-pagination" aria-label="预览分页">
              <Button variant="outline" size="sm" type="button" :disabled="page <= 1" @click="page -= 1">上一页</Button>
              <span>{{ page }} / {{ pageCount }}</span>
              <Button variant="outline" size="sm" type="button" :disabled="page >= pageCount" @click="page += 1">下一页</Button>
            </div>
          </div>
          <div class="transaction-import-table-scroll">
            <Table class="transaction-import-table">
              <TableHeader>
                <TableRow>
                  <TableHead aria-label="选择" class="transaction-import-check-cell">
                    <Checkbox
                      :checked="selectionState"
                      aria-label="选中或取消全部导入记录"
                      @update:checked="setAllSelected"
                    />
                  </TableHead>
                  <TableHead>日期</TableHead>
                  <TableHead>记录名称</TableHead>
                  <TableHead>收支类型</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead>账户</TableHead>
                  <TableHead class="transaction-import-amount-cell">金额（CNY）</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in visibleRows" :key="`${row.sourceType}:${row.sourceId}`" :class="{ 'transaction-import-row-invalid': row.selected && rowIssue(row) }">
                  <TableCell class="transaction-import-check-cell">
                    <Checkbox
                      :checked="row.selected"
                      :aria-label="`选择${row.name}`"
                      @update:checked="row.selected = $event === true"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      :model-value="row.date"
                      type="date"
                      aria-label="修正记录日期"
                      @update:model-value="row.date = String($event ?? '')"
                    />
                    <small v-if="row.time">{{ row.time }}</small>
                  </TableCell>
                  <TableCell class="transaction-import-name-cell">
                    <Input
                      :model-value="row.name"
                      type="text"
                      maxlength="80"
                      aria-label="修正记录名称"
                      @update:model-value="row.name = String($event ?? '')"
                    />
                    <small v-if="row.note" :title="row.note">{{ row.note }}</small>
                  </TableCell>
                  <TableCell>
                    <Select :model-value="row.direction" @update:model-value="setDirection(row, $event)">
                      <SelectTrigger class="transaction-import-select" :aria-label="`修改${row.name}的收支类型`">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="expense">支出</SelectItem>
                          <SelectItem value="income">收入</SelectItem>
                          <SelectItem value="refund">退款</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select :key="`${row.sourceId}:${row.direction}`" :model-value="row.cat" @update:model-value="row.cat = String($event ?? '')">
                      <SelectTrigger class="transaction-import-select" :aria-label="`修改${row.name}的分类`">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem v-for="category in categoryChoices(row)" :key="category.key" :value="category.key">
                            {{ category.icon }} {{ category.name }}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select :model-value="row.account" @update:model-value="row.account = String($event ?? '')">
                      <SelectTrigger class="transaction-import-select" :aria-label="`修改${row.name}的账户`">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem v-for="account in accountChoices" :key="account" :value="account">{{ account }}</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell class="transaction-import-amount-cell">
                    <Input
                      :model-value="row.amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputmode="decimal"
                      aria-label="修正记录金额"
                      @update:model-value="row.amount = String($event ?? '')"
                    />
                    <small v-if="row.selected && rowIssue(row)" class="transaction-import-row-issue">{{ rowIssue(row) }}</small>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
        <Empty v-else class="transaction-import-empty">
          <EmptyHeader>
            <EmptyTitle>没有可导入记录</EmptyTitle>
            <EmptyDescription>该文件里的流水已经导入过，或无法识别出有效收支记录。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </template>

      <p v-if="invalidSelectedRows.length" class="transaction-import-error" role="alert">
        所选记录中有 {{ invalidSelectedRows.length }} 条需要修正后才能导入。
      </p>

      <div class="transaction-import-footer">
        <Button type="button" variant="outline" :disabled="busy" @click="close">取消</Button>
        <Button type="button" :disabled="!canImport" @click="confirmImport">
          {{ busy ? '正在导入…' : `导入 ${validSelectedRows.length} 笔` }}
        </Button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.transaction-import {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.transaction-import-file :deep([data-slot='field-label']) {
  color: var(--text);
}

.transaction-import-file-actions,
.transaction-import-preview-head,
.transaction-import-pagination,
.transaction-import-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.transaction-import-file-actions {
  flex-wrap: wrap;
}

.transaction-import-filename,
.transaction-import-preview-head p,
.transaction-import-pagination span {
  color: var(--ink-soft);
  font-size: var(--fs-12-5);
}

.transaction-import-summary :deep([data-slot='card-header']),
.transaction-import-summary :deep([data-slot='card-content']) {
  padding: 14px;
}

.transaction-import-summary :deep([data-slot='card-header']) {
  gap: 4px;
  padding-bottom: 0;
}

.transaction-import-counts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.transaction-import-counts > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.transaction-import-counts span,
.transaction-import-table small {
  color: var(--ink-soft);
  font-size: var(--fs-11-5);
}

.transaction-import-counts strong {
  color: var(--text);
  font-size: var(--fs-18);
  font-variant-numeric: tabular-nums;
}

.transaction-import-totals {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: 12px;
  color: var(--ink-soft);
  font-size: var(--fs-12-5);
}

.transaction-import-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.transaction-import-preview-head {
  justify-content: space-between;
  flex-wrap: wrap;
}

.transaction-import-preview-head p {
  margin: 0;
}

.transaction-import-pagination {
  flex-wrap: wrap;
}

.transaction-import-table-scroll {
  max-height: min(48vh, 560px);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--card-radius);
  background: var(--card);
}

.transaction-import-table {
  min-width: 1020px;
}

.transaction-import-check-cell {
  width: 44px;
  text-align: center;
}

.transaction-import-amount-cell {
  width: 142px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.transaction-import-name-cell {
  min-width: 200px;
}

.transaction-import-name-cell small,
.transaction-import-amount-cell small {
  display: block;
  max-width: 240px;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transaction-import-row-invalid {
  background: var(--danger-soft);
}

.transaction-import-row-issue,
.transaction-import-error {
  color: var(--danger);
}

.transaction-import-select {
  width: 100%;
  min-width: 110px;
}

.transaction-import-empty {
  min-height: 180px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--card-radius);
}

.transaction-import-error {
  margin: 0;
  font-size: var(--fs-12-5);
}

.transaction-import-footer {
  justify-content: flex-end;
  padding-top: 4px;
}

@media (max-width: 760px) {
  .transaction-import-counts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .transaction-import-totals {
    flex-direction: column;
    gap: 5px;
  }

  .transaction-import-footer :deep(button) {
    flex: 1;
  }
}
</style>
