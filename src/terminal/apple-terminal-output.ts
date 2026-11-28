import { Writable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

// Apple Terminal prints parts of unsupported DCS/APC and capability queries.
// Filter the renderer's output before it reaches the TTY, including queries
// split across native output chunks. Keep text, colors, mouse and cursor control.
export class AppleTerminalOutput extends Writable {
  private decoder = new StringDecoder('utf8')
  private pending = ''
  private cursorReply = ''
  private origin?: { row: number; column: number }
  private padding = 0
  private onCursor?: () => void
  private initialRows: number
  private initialColumns: number
  constructor(private target: NodeJS.WriteStream) {
    super()
    this.initialRows = target.rows
    this.initialColumns = target.columns
  }
  get columns() { return this.target.columns }
  get rows() { return this.target.rows }
  get isTTY() { return this.target.isTTY }

  // The first CPR answers OpenTUI's existing query on the shell screen.
  // Observe it without consuming input or sending a second query.
  rememberCursor = (chunk: Buffer) => {
    if (this.origin) return
    this.cursorReply += chunk.toString('utf8')
    const match = /\x1b\[(\d+);(\d+)R/.exec(this.cursorReply)
    if (match) {
      this.origin = { row: Number(match[1]), column: Number(match[2]) }
      this.cursorReply = ''
      this.onCursor?.()
    } else this.cursorReply = this.cursorReply.slice(-32)
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    const input = this.pending + this.decoder.write(chunk)
    this.pending = ''
    let output = '', offset = 0
    while (offset < input.length) {
      const start = input.indexOf('\x1b', offset)
      if (start < 0) { output += input.slice(offset); break }
      output += input.slice(offset, start)
      const type = input[start + 1]
      let end = start + 2
      if (type === '[') {
        while (end < input.length && !/[\x40-\x7e]/.test(input[end]!)) end++
        end++
      } else if (type === ']' || type === 'P' || type === '_' || type === '^') {
        while (end < input.length && input[end] !== '\x07' && input.slice(end, end + 2) !== '\x1b\\') end++
        end += input[end] === '\x07' ? 1 : 2
      }
      if (end > input.length) { this.pending = input.slice(start); break }
      const sequence = input.slice(start, end)
      const unsupported = type === 'P' || type === '_' ||
        /^\x1b\[(?:\?[\d;]*\$p|\?u|>[\d;]*q)$/.test(sequence) ||
        sequence.startsWith('\x1b]66;')
      if (!unsupported) output += sequence
      if (sequence === '\x1b[?1049l' && this.origin) {
        // When Terminal shrinks, the top rows move into scrollback. Remove
        // only the leading padding still visible in the returned viewport.
        const remaining = Math.max(0, this.padding - Math.max(0, this.initialRows - this.rows))
        if (remaining) output += `\x1b[H\x1b[${remaining}M`
        if (this.padding || this.rows !== this.initialRows || this.columns !== this.initialColumns) {
          const row = Math.min(this.origin.row, this.rows)
          const column = Math.min(this.origin.column, this.columns)
          output += `\x1b[${row};${column}H`
        }
      }
      offset = end
    }
    const enter = output.indexOf('\x1b[?1049h')
    if (enter >= 0) {
      // Send OpenTUI's cursor query before switching screens. Anchor the
      // occupied shell rows at the bottom so a shrink discards padding first.
      const start = () => {
        clearTimeout(timer)
        this.onCursor = undefined
        let setup = ''
        if (this.origin) {
          this.padding = Math.max(0, this.initialRows - this.origin.row)
          if (this.padding) setup = `\x1b[H\x1b[${this.padding}L\x1b[${this.initialRows};${this.origin.column}H`
        }
        this.target.write(setup + output.slice(enter), done)
      }
      const timer = setTimeout(start, 150)
      this.onCursor = start
      if (enter) this.target.write(output.slice(0, enter))
      if (this.origin) start()
      return
    }
    if (output) this.target.write(output, done)
    else done()
  }
}
