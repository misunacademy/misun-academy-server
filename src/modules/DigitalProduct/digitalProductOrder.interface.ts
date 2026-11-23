import { Types } from 'mongoose';

export type DigitalProductPaymentMethod = 'SSLCommerz' | 'PhonePe_Manual' | 'Perk' | 'Free';
export type DigitalProductOrderStatus = 'pending' | 'paid' | 'rejected';
export type DigitalProductCurrency = 'BDT' | 'INR';

export interface IDigitalProductCustomer {
    name: string;
    email: string;
    phone: string;
    country: string; // 'BD' | 'IN' | 'OTHER'
}

export interface IDigitalProductOrder {
    _id: Types.ObjectId;
    orderNumber: string;
    product: Types.ObjectId;
    productSnapshot: {
        title: string;
        slug: string;
        software: string;
    };
    user?: Types.ObjectId;
    customer: IDigitalProductCustomer;
    paymentMethod: DigitalProductPaymentMethod;
    currency: DigitalProductCurrency;
    amount: number;
    transactionId: string;
    senderNumber?: string; // PhonePe sender phone/UPI ID
    status: DigitalProductOrderStatus;
    gatewayResponse?: Record<string, unknown>;
    adminNote?: string;
    reviewedBy?: Types.ObjectId;
    reviewedAt?: Date;
    downloadToken: string;
    downloadCount: number;
    valId?: string;
    createdAt: Date;
    updatedAt: Date;
}
