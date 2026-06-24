export class ProviderActionExecutionError extends Error {
  readonly errorCode: string;
  readonly retryRecommended: boolean;

  constructor(params: {
    errorCode: string;
    message: string;
    retryRecommended: boolean;
  }) {
    super(params.message);
    this.name = 'ProviderActionExecutionError';
    this.errorCode = params.errorCode;
    this.retryRecommended = params.retryRecommended;
  }
}
