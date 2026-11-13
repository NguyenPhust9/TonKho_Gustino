import { getAllStockSummaries } from '../../cukcuk-stock.mjs'

export const config = { maxDuration: 60 }

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return response.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const { from, to } = request.query
    const data = await getAllStockSummaries({
      fromDate: typeof from === 'string' ? from : undefined,
      toDate: typeof to === 'string' ? to : undefined,
    })
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).json(data)
  } catch (error) {
    return response.status(502).json({ error: error.message })
  }
}
