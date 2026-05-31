import { PluginMessage } from './types'

export const sendMsgToUI = (type: PluginMessage, data?: unknown): void => {
  mg.ui.postMessage({ type, data })
}
