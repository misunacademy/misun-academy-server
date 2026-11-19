import { ZodError, ZodIssue } from 'zod';
import { IGenericErrorResponse } from '../types/response.interfaces.js';

export default function handleZodError(error: ZodError): IGenericErrorResponse {
    const statusCode = 400;
    const message = 'Validation Error';
    const errorMessages = error.issues.map((issue: ZodIssue) => {
        // Zod 4 issue paths are PropertyKey[]; the API contract only allows
        // string | number, so stringify the rare symbol segment.
        const lastSegment = issue.path[issue.path.length - 1];
        return {
            path: typeof lastSegment === 'symbol' ? lastSegment.toString() : lastSegment,
            message: issue.message
        };
    });

    return {
        statusCode,
        message,
        errorMessages
    };
}