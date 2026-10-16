function parseCapture(source, requested, today) {
  const text = String(source || '').trim()
  if (!text) throw new Error('先写下想记录的内容。')
  const kind = requested || (/\d+(?:\.\d{1,2})?\s*(?:元|块)|(?:支出|花了|消费)/.test(text) ? 'transaction' : /(?:笔记|想法|灵感)/.test(text) ? 'note' : 'task')
  const date = new Date(`${today}T00:00:00Z`)
  let dueDate = ''
  const explicit = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/)
  if (explicit) dueDate = `${explicit[1]}-${explicit[2].padStart(2,'0')}-${explicit[3].padStart(2,'0')}`
  else if (/后天/.test(text)) { date.setUTCDate(date.getUTCDate()+2); dueDate=date.toISOString().slice(0,10) }
  else if (/明天/.test(text)) { date.setUTCDate(date.getUTCDate()+1); dueDate=date.toISOString().slice(0,10) }
  else if (/今天|今日/.test(text)) dueDate=today
  else {
    const weekday = text.match(/(下)?(?:周|星期)([一二三四五六日天])/)
    if(weekday) { const current=date.getUTCDay()||7; const target='一二三四五六日'.indexOf(weekday[2]==='天'?'日':weekday[2])+1; const offset=weekday[1] ? 7-current+target : (target-current+7)%7; date.setUTCDate(date.getUTCDate()+offset); dueDate=date.toISOString().slice(0,10) }
  }
  const clock=text.match(/(?:^|\D)([01]?\d|2[0-3])[:：]([0-5]\d)/)
  const time=clock?`${clock[1].padStart(2,'0')}:${clock[2]}`:''
  const values = { title: text.split('\n')[0].slice(0,100), note: text, dueDate, dueTime: time, date: dueDate || today }
  if(kind==='transaction' || kind==='bill') {
    const amount=text.match(/(?:^|[^\d])(\d+(?:\.\d{1,2})?)\s*(?:元|块|$)/)
    values.amount=amount?amount[1]:''; values.currency='CNY'; values.direction=/收入|到账|工资|报销/.test(text)?'income':'expense'
  }
  if(kind==='event') values.time=time
  if(kind==='note') { values.body=text; values.note='' }
  if(kind==='list') values.lines=text
  return { kind, values }
}
module.exports={parseCapture}
