import { normalizeSimulatorScreenshotFrame, type SimulatorScreenshotFrame } from './simulatorScreenshotFrame';

export type AndroidScreenshotFrame = SimulatorScreenshotFrame;

export const normalizeAndroidScreenshotFrame = normalizeSimulatorScreenshotFrame;
