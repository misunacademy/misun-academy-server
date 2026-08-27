export interface IResponseMeta {
    page: number;
    limit: number;
    total: number;
    totalPages?: number;
    currentPage?: number;
}

export interface IGenericResponse<T> {
    statusCode: number;
    success: boolean;
    message: string;
    meta?: IResponseMeta;
    data: T | null;
    serverTimestamp?: number;
}

export interface IErrorMessage {
    path: string | number;
    message: string;
}

export interface IGenericErrorResponse {
    statusCode: number;
    message: string;
    errorMessages: IErrorMessage[];
}

export interface IGenericFilterOptions {
    limit?: number;
    page?: number;
    sortBy?: string;
    sortOrder?: SortOrder;
}

export enum SortOrder {
    ASC = 'asc',
    DESC = 'desc'
}
