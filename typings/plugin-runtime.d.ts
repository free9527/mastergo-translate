interface XMLHttpRequest {
  status: number
  responseText: string
  timeout: number
  onload: (() => void) | null
  onerror: (() => void) | null
  ontimeout: (() => void) | null
  open(method: string, url: string, async?: boolean): void
  setRequestHeader(name: string, value: string): void
  send(body?: string | null): void
}

declare const XMLHttpRequest: {
  new (): XMLHttpRequest
}
