import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
const mockStreamChatCompletion = vi.fn()

vi.mock('groq-sdk', () => ({
  default: class {
    chat = {
      completions: {
        create: mockCreate,
      },
    }
  },
}))

vi.mock('../../src/lib/aiChatService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/aiChatService')>()
  return {
    ...actual,
    streamChatCompletion: mockStreamChatCompletion,
  }
})

describe('Vercel API: /api/ai/chat handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-POST requests with 405', async () => {
    const handler = (await import('./chat')).default
    const req: any = { method: 'GET', body: {} }
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(405)
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' })
  })

  it('validates messages array and rejects invalid payloads with 400', async () => {
    const handler = (await import('./chat')).default
    const req: any = { method: 'POST', body: {} }
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'messages array required' })
  })

  it('returns JSON completion on valid POST', async () => {
    mockCreate.mockResolvedValue({
      model: 'llama-3.3-70b-versatile',
      choices: [{ message: { content: 'AI answer' } }],
    })

    const handler = (await import('./chat')).default
    const req: any = {
      method: 'POST',
      headers: {},
      query: {},
      body: {
        messages: [{ role: 'user', content: 'What is Stellar?' }],
      },
    }
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.json).toHaveBeenCalledWith({
      content: 'AI answer',
      model: 'llama-3.3-70b-versatile',
    })
  })

  it('returns 500 with formatted error when the non-stream completion fails', async () => {
    mockCreate.mockRejectedValue(new Error('api down'))

    const handler = (await import('./chat')).default
    const req: any = {
      method: 'POST',
      headers: {},
      query: {},
      body: {
        messages: [{ role: 'user', content: 'What is Stellar?' }],
      },
    }
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Groq AI error: api down' })
  })

  it('streams SSE events for text/event-stream requests', async () => {
    mockStreamChatCompletion.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'Hello' } }] }
        yield { choices: [{ delta: { content: ' world' } }] }
      })()
    )

    const handler = (await import('./chat')).default
    const req: any = {
      method: 'POST',
      headers: { accept: 'text/event-stream' },
      query: {},
      body: {
        messages: [{ role: 'user', content: 'Stream me' }],
      },
      on: vi.fn(),
    }
    const res: any = {
      setHeader: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      flushHeaders: vi.fn(),
    }

    await handler(req, res)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform')
    expect(res.flushHeaders).toHaveBeenCalled()
    expect(req.on).toHaveBeenCalledWith('close', expect.any(Function))
    expect(res.write).toHaveBeenCalledWith('event: delta\n')
    expect(res.write).toHaveBeenCalledWith('data: {"content":"Hello"}\n\n')
    expect(res.write).toHaveBeenCalledWith('event: done\n')
    expect(res.end).toHaveBeenCalled()
  })

  it('streams an SSE error event when the stream fails', async () => {
    mockStreamChatCompletion.mockRejectedValue(new Error('stream failed'))

    const handler = (await import('./chat')).default
    const req: any = {
      method: 'POST',
      headers: { accept: 'text/event-stream' },
      query: {},
      body: {
        messages: [{ role: 'user', content: 'Boom' }],
      },
      on: vi.fn(),
    }
    const res: any = {
      setHeader: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      flushHeaders: vi.fn(),
    }

    await handler(req, res)
    expect(res.write).toHaveBeenCalledWith('event: error\n')
    expect(res.write).toHaveBeenCalledWith('data: {"error":"Groq AI error: stream failed"}\n\n')
    expect(res.end).toHaveBeenCalled()
  })
})
