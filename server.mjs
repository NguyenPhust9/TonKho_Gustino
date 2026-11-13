import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { existsSync } from 'node:fs'
import { getAllStockSummaries } from './cukcuk-stock.mjs'

// Nạp biến môi trường từ .env.local hoặc .env nếu có
for (const envFile of ['.env.local', '.env']) {
  if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(envFile)
      break
    } catch {
      // Bỏ qua nếu không đọc được
    }
  }
}

const root = join(process.cwd(), 'public')
const port = Number(process.env.PORT || 4173)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
}

const json = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  })
  res.end(JSON.stringify(data))
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  if (url.pathname === '/api/inventory/all') {
    try {
      const summary = await getAllStockSummaries({
        fromDate: url.searchParams.get('from') || undefined,
        toDate: url.searchParams.get('to') || undefined
      })
      return json(res, 200, summary)
    } catch (error) {
      return json(res, 502, { error: error.message })
    }
  }


  const requestedPath = url.pathname === '/' ? 'index.html' : url.pathname
  const file = normalize(join(root, requestedPath))
  if (!file.startsWith(root)) {
    return json(res, 403, { error: 'Không được phép.' })
  }

  try {
    const data = await readFile(file)
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    })
    res.end(data)
  } catch {
    json(res, 404, { error: 'Không tìm thấy tệp yêu cầu.' })
  }
}).listen(port, () => {
  console.log(`TonKho Gustino: http://localhost:${port}`)
})
