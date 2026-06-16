// Max Coder — minimal MCP (Model Context Protocol) stdio client (Bun-native via Bun.spawn).
// Reads ~/.maxcoder/mcp.json, connects to each server, lists tools, and registers them into the
// registry as `mcp__<server>__<tool>`. Analog of src/services/mcp/* (minimal: stdio + tools only).
//
// mcp.json shape:
//   { "mcpServers": { "fs": { "command": "npx", "args": ["-y","@modelcontextprotocol/server-filesystem","."] } } }

import { mcpConfigPath } from '../../shared/config/index.ts'
import { readJSON } from '../../shared/fs/index.ts'
import { registerTool } from '../../tools.ts'

interface ServerCfg {
  command: string
  args?: string[]
  env?: Record<string, string>
}

interface JsonRpcResponse {
  id?: number
  result?: any
  error?: { message?: string }
}

class McpStdioClient {
  private proc!: ReturnType<typeof Bun.spawn>
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private buf = ''

  constructor(private name: string, private cfg: ServerCfg) {}

  async start(): Promise<void> {
    this.proc = Bun.spawn([this.cfg.command, ...(this.cfg.args ?? [])], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
      env: this.cfg.env ? { ...process.env, ...this.cfg.env } : process.env,
    })
    this.readLoop()
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'maxcoder', version: '0.2.0' },
    })
    this.notify('notifications/initialized', {})
  }

  private async readLoop(): Promise<void> {
    const reader = (this.proc.stdout as ReadableStream<Uint8Array>).getReader()
    const dec = new TextDecoder()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      this.buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim()
        this.buf = this.buf.slice(nl + 1)
        if (!line) continue
        let msg: JsonRpcResponse
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.id != null && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if (msg.error) p.reject(new Error(msg.error.message ?? 'mcp error'))
          else p.resolve(msg.result)
        }
      }
    }
  }

  private write(obj: unknown): void {
    const stdin = this.proc.stdin
    if (!stdin || typeof stdin === 'number') return
    stdin.write(JSON.stringify(obj) + '\n')
    stdin.flush()
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write({ jsonrpc: '2.0', id, method, params })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('mcp request timeout'))
        }
      }, 30_000)
    })
  }

  async listTools(): Promise<any[]> {
    const r = await this.request('tools/list', {})
    return r?.tools ?? []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const r = await this.request('tools/call', { name, arguments: args })
    const content = r?.content ?? []
    return content.map((c: any) => (c?.type === 'text' ? c.text : JSON.stringify(c))).join('\n') || '(no content)'
  }
}

export interface McpLoadResult {
  servers: number
  tools: number
  errors: string[]
}

export async function loadMcpTools(): Promise<McpLoadResult> {
  const cfg = await readJSON<{ mcpServers?: Record<string, ServerCfg> }>(mcpConfigPath())
  const servers = cfg?.mcpServers ?? {}
  const result: McpLoadResult = { servers: 0, tools: 0, errors: [] }

  for (const [name, sc] of Object.entries(servers)) {
    try {
      const client = new McpStdioClient(name, sc)
      await client.start()
      const tools = await client.listTools()
      result.servers++
      for (const t of tools) {
        registerTool({
          name: `mcp__${name}__${t.name}`,
          description: t.description || `${name} ${t.name}`,
          parameters: t.inputSchema || { type: 'object', properties: {} },
          mutating: true,
          source: 'mcp',
          run: async args => client.callTool(t.name, args),
        })
        result.tools++
      }
    } catch (e) {
      result.errors.push(`${name}: ${e instanceof Error ? e.message : e}`)
    }
  }
  return result
}
