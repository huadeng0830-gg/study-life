import { createWorker, OEM, PSM } from 'tesseract.js'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseTimetableLayout, scoreTimetableExtraction } from '../src/composables/timetableLayoutParser.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const images = process.argv.slice(2)
const benchmarkTimeConfig = {
  value: {
    periods: Array.from({ length: 12 }, (_, index) => ({ id: `p${index + 1}`, label: `第${index + 1}节课` })),
  },
}

function extractLayout(blocks, width = 1280, height = 2781) {
  const lines = []
  const words = []
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        lines.push({ text: line.text, confidence: line.confidence, bbox: { ...line.bbox } })
        for (const word of line.words || []) words.push({ text: word.text, confidence: word.confidence, bbox: { ...word.bbox } })
      }
    }
  }
  return { width, height, lines, words }
}

if (!images.length) {
  console.error('Usage: node tests/ocr-reference-read.mjs <image...>')
  process.exitCode = 1
} else {
  const worker = await createWorker('chi_sim', OEM.LSTM_ONLY, {
    langPath: path.join(projectRoot, 'public', 'ocr'),
    gzip: false,
    logger: (message) => {
      if (message.status === 'recognizing text') process.stderr.write(`\r${Math.round(message.progress * 100)}%`)
    },
  })
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    preserve_interword_spaces: '1',
    user_defined_dpi: '180',
  })
  for (const imagePath of images) {
    const data = await readFile(imagePath)
    const result = await worker.recognize(data, {}, { text: true, blocks: true })
    console.log(`\n--- ${path.basename(imagePath)} | confidence=${result.data.confidence.toFixed(2)} ---`)
    console.log(result.data.text.trim())
    const layout = extractLayout(result.data.blocks)
    const table = parseTimetableLayout(layout, benchmarkTimeConfig, 25)
    const metrics = scoreTimetableExtraction(table)
    console.log(`\n[structured] courses=${table.courses.length}, headers=${table.detectedHeaders}, review=${metrics.reviewCount}, score=${metrics.score.toFixed(1)}`)
  }
  await worker.terminate()
}
