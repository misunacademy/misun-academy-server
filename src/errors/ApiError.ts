class ApiError extends Error {
    statusCode: number;
    code?: string;
    details?: Record<string, unknown>;

    constructor(
        statusCode: number,
        message: string | undefined,
        stack = '',
        options?: { code?: string; details?: Record<string, unknown> }
    ) {
        super(message);
        this.statusCode = statusCode;
        this.code = options?.code;
        this.details = options?.details;
        if (stack) {
            this.stack = stack;
        } else {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

export default ApiError;