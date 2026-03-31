import { Response } from 'express';
import { IGenericResponse } from '../types/response.interfaces.js';

const sendResponse = <T>(
    res: Response,
    data: IGenericResponse<T>
) => {
    const response: IGenericResponse<T> = {
        success: data.success,
        statusCode: data.statusCode,
        message: data.message || 'Success',
        meta: data.meta,
        data: data.data || null
    };

    res.status(data.statusCode).json(response);
};

export default sendResponse;