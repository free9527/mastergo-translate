import { UIMessage } from './types'

export const sendMsgToPlugin = (type: UIMessage, data?: unknown): void => {
  parent.postMessage({ pluginMessage: { type, data } }, '*')
}
