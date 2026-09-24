const BASE = 'http://127.0.0.1:5173'
const keyword = process.argv[2] || '非洲移民'

const feeds = [
  'bbc-zh',
  'nytimes-zh',
  'dw-top',
  'aljazeera',
  'france24',
  'scmp-china',
  'netease',
  'sspai',
  'ithome',
]

for (const id of feeds) {
  const res = await fetch(`${BASE}/api/feed/${id}`)
  const text = await res.text()
  if (!res.ok) {
    console.log(id, 'feed fail', res.status)
    continue
  }
  if (!text.includes(keyword) && !text.includes('摩洛哥') && !text.includes('Ceuta')) continue
  console.log('HIT', id)

  // crude extract nearby urls
  const idx = Math.max(text.indexOf(keyword), text.indexOf('摩洛哥'), text.indexOf('Ceuta'))
  console.log('snippet', text.slice(Math.max(0, idx - 200), idx + 400).replace(/\s+/g, ' '))
}
