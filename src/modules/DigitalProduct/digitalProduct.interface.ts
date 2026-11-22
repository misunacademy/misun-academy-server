import { Types } from 'mongoose';

export type DigitalProductSoftware = 'photoshop' | 'illustrator' | 'bundle' | 'other';

export interface IDigitalProductFile {
    fileName: string;
    url: string;
    fileSize?: string;
}

export interface IDigitalProduct {
    _id: Types.ObjectId;
    title: string;
    slug: string;
    tagline?: string;
    description?: string;
    software: DigitalProductSoftware;
    priceBDT: number;
    discountPriceBDT?: number;
    priceINR: number;
    discountPriceINR?: number;
    thumbnail?: string;
    badge?: string; // e.g. "বেস্টসেলার", "নতুন", "বান্ডেল সেভার"
    features: string[];
    scriptFile: IDigitalProductFile;
    guidePdf: IDigitalProductFile;
    isPublished: boolean;
    salesCount: number;
    createdBy?: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}
