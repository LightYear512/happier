export const SOCKET_RPC_EVENTS = {
  REGISTER: 'rpc-register',
  REGISTERED: 'rpc-registered',
  UNREGISTER: 'rpc-unregister',
  UNREGISTERED: 'rpc-unregistered',
  ERROR: 'rpc-error',
  CALL: 'rpc-call',
  REQUEST: 'rpc-request',
  MACHINE_TRANSFER_ENVELOPE: 'machine-transfer-envelope',
  DEV_PREVIEW_TO_MACHINE_ENVELOPE: 'dev-preview-to-machine-envelope',
  DEV_PREVIEW_FROM_MACHINE_ENVELOPE: 'dev-preview-from-machine-envelope',
} as const;

export type SocketRpcEvent = (typeof SOCKET_RPC_EVENTS)[keyof typeof SOCKET_RPC_EVENTS];
