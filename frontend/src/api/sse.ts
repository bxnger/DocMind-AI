export interface SseMessage {
  event: string;
  data: string;
}

/** Incremental text/event-stream parser. Chunks can split anywhere, even inside a line. */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseMessage[] {
    this.buffer += chunk.replace(/\r\n?/g, '\n');
    const messages: SseMessage[] = [];
    let end = this.buffer.indexOf('\n\n');
    while (end !== -1) {
      const message = parseBlock(this.buffer.slice(0, end));
      if (message) messages.push(message);
      this.buffer = this.buffer.slice(end + 2);
      end = this.buffer.indexOf('\n\n');
    }
    return messages;
  }
}

function parseBlock(block: string): SseMessage | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : null;
}
