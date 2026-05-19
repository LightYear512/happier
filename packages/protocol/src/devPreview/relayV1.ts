import { z } from 'zod';

export const SessionDevPreviewTokenResponseSchema = z.object({
  token: z.string().min(1),
}).passthrough();
export type SessionDevPreviewTokenResponse = z.infer<typeof SessionDevPreviewTokenResponseSchema>;

export const DaemonSessionDevPreviewHttpMethodSchema = z.enum([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);
export type DaemonSessionDevPreviewHttpMethod = z.infer<typeof DaemonSessionDevPreviewHttpMethodSchema>;

export const DaemonSessionDevPreviewHeaderMapSchema = z.record(z.string(), z.string());
export type DaemonSessionDevPreviewHeaderMap = z.infer<typeof DaemonSessionDevPreviewHeaderMapSchema>;

export const DaemonSessionDevPreviewHttpRequestSchema = z.object({
  sessionId: z.string().min(1),
  machineId: z.string().min(1),
  routeKey: z.string().min(1),
  method: DaemonSessionDevPreviewHttpMethodSchema,
  path: z.string().min(1).max(10_000),
  search: z.string().max(10_000).optional(),
  headers: DaemonSessionDevPreviewHeaderMapSchema.default({}),
  bodyBase64: z.string().max(20 * 1024 * 1024).optional(),
}).passthrough();
export type DaemonSessionDevPreviewHttpRequest = z.infer<typeof DaemonSessionDevPreviewHttpRequestSchema>;

export const DaemonSessionDevPreviewHttpErrorCodeSchema = z.enum([
  'preview_invalid_request',
  'preview_not_found',
  'preview_dead',
  'preview_unreachable',
]);
export type DaemonSessionDevPreviewHttpErrorCode = z.infer<typeof DaemonSessionDevPreviewHttpErrorCodeSchema>;

export const DaemonSessionDevPreviewHttpErrorSchema = z.object({
  ok: z.literal(false),
  errorCode: DaemonSessionDevPreviewHttpErrorCodeSchema,
  error: z.string().min(1),
}).passthrough();
export type DaemonSessionDevPreviewHttpError = z.infer<typeof DaemonSessionDevPreviewHttpErrorSchema>;

export const DaemonSessionDevPreviewHttpSuccessSchema = z.object({
  ok: z.literal(true),
  status: z.number().int().min(100).max(599),
  headers: DaemonSessionDevPreviewHeaderMapSchema,
  bodyBase64: z.string().optional(),
}).passthrough();
export type DaemonSessionDevPreviewHttpSuccess = z.infer<typeof DaemonSessionDevPreviewHttpSuccessSchema>;

export const DaemonSessionDevPreviewHttpResponseSchema = z.union([
  DaemonSessionDevPreviewHttpSuccessSchema,
  DaemonSessionDevPreviewHttpErrorSchema,
]);
export type DaemonSessionDevPreviewHttpResponse = z.infer<typeof DaemonSessionDevPreviewHttpResponseSchema>;

const SessionDevPreviewSocketTunnelIdSchema = z.string().min(1).max(256);
const SessionDevPreviewSocketPathSchema = z.string().min(1).max(10_000);
const SessionDevPreviewSocketSearchSchema = z.string().max(10_000);
const SessionDevPreviewSocketTextPayloadSchema = z.string().max(20 * 1024 * 1024);
const SessionDevPreviewSocketBinaryPayloadSchema = z.string().max(20 * 1024 * 1024);
const SessionDevPreviewSocketCloseCodeSchema = z.number().int().min(1000).max(4999);
const SessionDevPreviewSocketCloseReasonSchema = z.string().max(123);
const SessionDevPreviewSocketSubprotocolSchema = z.string().min(1).max(255);

export const SessionDevPreviewSocketServerToMachineEnvelopeSchema = z.discriminatedUnion('kind', [
  z.object({
    tunnelId: SessionDevPreviewSocketTunnelIdSchema,
    kind: z.literal('open'),
    sessionId: z.string().min(1),
    machineId: z.string().min(1),
    routeKey: z.string().min(1),
    path: SessionDevPreviewSocketPathSchema,
    search: SessionDevPreviewSocketSearchSchema.optional(),
    requestedSubprotocols: z.array(SessionDevPreviewSocketSubprotocolSchema).max(16).optional(),
  }).passthrough(),
  z.object({
    tunnelId: SessionDevPreviewSocketTunnelIdSchema,
    kind: z.literal('text'),
    text: SessionDevPreviewSocketTextPayloadSchema,
  }).passthrough(),
  z.object({
    tunnelId: SessionDevPreviewSocketTunnelIdSchema,
    kind: z.literal('binary'),
    dataBase64: SessionDevPreviewSocketBinaryPayloadSchema,
  }).passthrough(),
  z.object({
    tunnelId: SessionDevPreviewSocketTunnelIdSchema,
    kind: z.literal('close'),
    code: SessionDevPreviewSocketCloseCodeSchema.optional(),
    reason: SessionDevPreviewSocketCloseReasonSchema.optional(),
  }).passthrough(),
]);
export type SessionDevPreviewSocketServerToMachineEnvelope = z.infer<typeof SessionDevPreviewSocketServerToMachineEnvelopeSchema>;

export const SessionDevPreviewSocketServerToMachineMessageSchema = z.object({
  envelope: SessionDevPreviewSocketServerToMachineEnvelopeSchema,
}).passthrough();
export type SessionDevPreviewSocketServerToMachineMessage = z.infer<typeof SessionDevPreviewSocketServerToMachineMessageSchema>;

export const SessionDevPreviewSocketMachineToServerEnvelopeSchema = z.discriminatedUnion('kind', [
  z.object({
    tunnelId: SessionDevPreviewSocketTunnelIdSchema,
    kind: z.literal('open'),
    acceptedSubprotocol: SessionDevPreviewSocketSubprotocolSchema.optional(),
  }).passthrough(),
  z.object({
    tunnelId: SessionDevPreviewSocketTunnelIdSchema,
    kind: z.literal('text'),
    text: SessionDevPreviewSocketTextPayloadSchema,
  }).passthrough(),
  z.object({
    tunnelId: SessionDevPreviewSocketTunnelIdSchema,
    kind: z.literal('binary'),
    dataBase64: SessionDevPreviewSocketBinaryPayloadSchema,
  }).passthrough(),
  z.object({
    tunnelId: SessionDevPreviewSocketTunnelIdSchema,
    kind: z.literal('close'),
    code: SessionDevPreviewSocketCloseCodeSchema.optional(),
    reason: SessionDevPreviewSocketCloseReasonSchema.optional(),
  }).passthrough(),
  z.object({
    tunnelId: SessionDevPreviewSocketTunnelIdSchema,
    kind: z.literal('error'),
    reason: z.string().min(1).max(2_048),
  }).passthrough(),
]);
export type SessionDevPreviewSocketMachineToServerEnvelope = z.infer<typeof SessionDevPreviewSocketMachineToServerEnvelopeSchema>;

export const SessionDevPreviewSocketMachineToServerMessageSchema = z.object({
  envelope: SessionDevPreviewSocketMachineToServerEnvelopeSchema,
}).passthrough();
export type SessionDevPreviewSocketMachineToServerMessage = z.infer<typeof SessionDevPreviewSocketMachineToServerMessageSchema>;
