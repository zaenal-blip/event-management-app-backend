export interface CreateTransactionBody {
  ticketTypeId: number;
  quantity: number;
  voucherCode?: string;
  couponCode?: string;
  pointsToUse?: number;
}

export interface UploadPaymentProofBody {
  paymentProof: string; // URL or base64, adjust based on your file upload strategy
}
