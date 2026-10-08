function normalize(value) {
  return String(value ?? '').trim().replace(/^"|"$/g, '').toLocaleLowerCase('en-US')
}

export function matchesDesktopPublisher(publisherNames, certificateSubject) {
  const subject = normalize(certificateSubject)
  if (!subject) return false
  const commonName = /(?:^|,)\s*CN=([^,]+)/i.exec(String(certificateSubject))?.[1]
  const normalizedCommonName = normalize(commonName)
  const names = (Array.isArray(publisherNames) ? publisherNames : [publisherNames])
    .map((name) => normalize(name))
    .filter(Boolean)
  return names.some((name) => {
    const declaredCommonName = name.replace(/^cn=/i, '')
    return name === subject || declaredCommonName === normalizedCommonName
  })
}
