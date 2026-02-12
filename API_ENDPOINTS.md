# API Endpoints Documentation

## Base URL
`http://localhost:8000`

## Authentication
Most endpoints require authentication via Bearer token:
```
Authorization: Bearer <token>
```

---

## Events

### GET /events
Get list of events with filters

**Query Parameters:**
- `page` (number, default: 1)
- `take` (number, default: 10)
- `sortBy` (string, default: "createdAt")
- `sortOrder` ("asc" | "desc", default: "desc")
- `search` (string, optional) - Search in title, description, location, venue
- `category` (string, optional)
- `location` (string, optional)
- `priceRange` ("all" | "free" | "paid", optional)
- `startDate` (ISO string, optional)
- `endDate` (ISO string, optional)

**Response:**
```json
{
  "data": [...events],
  "meta": {
    "page": 1,
    "take": 10,
    "total": 50
  }
}
```

### GET /events/:id
Get event details by ID

**Response:**
```json
{
  "id": 1,
  "title": "Event Title",
  "description": "...",
  "organizer": {...},
  "ticketTypes": [...],
  "vouchers": [...]
}
```

### POST /events
Create new event (Organizer only)

**Headers:**
- `Authorization: Bearer <token>`

**Body:**
```json
{
  "title": "Event Title",
  "description": "Event description",
  "image": "https://...",
  "category": "music",
  "location": "Jakarta",
  "venue": "Venue Name",
  "startDate": "2025-03-15T10:00:00Z",
  "endDate": "2025-03-17T23:00:00Z",
  "ticketTypes": [
    {
      "name": "Regular",
      "description": "...",
      "price": 750000,
      "totalSeat": 3000
    }
  ]
}
```

### POST /events/:eventId/vouchers
Create voucher for event (Organizer only)

**Headers:**
- `Authorization: Bearer <token>`

**Body:**
```json
{
  "code": "EARLYBIRD25",
  "discountAmount": 25,
  "discountType": "PERCENTAGE",
  "startDate": "2025-01-01T00:00:00Z",
  "endDate": "2025-02-28T23:59:59Z",
  "usageLimit": 500
}
```

---

## Transactions

### POST /events/:eventId/transactions
Create transaction (Customer only)

**Headers:**
- `Authorization: Bearer <token>`

**Body:**
```json
{
  "ticketTypeId": 1,
  "quantity": 2,
  "voucherCode": "EARLYBIRD25",
  "couponCode": "WELCOME100K",
  "pointsToUse": 20000
}
```

**Response:**
```json
{
  "id": 1,
  "status": "WAITING_PAYMENT",
  "finalPrice": 2130000,
  "expiredAt": "2025-01-25T12:00:00Z",
  ...
}
```

### GET /me/transactions
Get current user's transactions (Customer only)

**Headers:**
- `Authorization: Bearer <token>`

### GET /transactions/:id
Get transaction by ID

**Headers:**
- `Authorization: Bearer <token>`

### PUT /transactions/:id/payment-proof
Upload payment proof (Customer only)

**Headers:**
- `Authorization: Bearer <token>`

**Body:**
```json
{
  "paymentProof": "https://storage.example.com/proof.jpg"
}
```

**Note:** Currently accepts URL string. For file upload, implement multer middleware.

### PUT /transactions/:id/confirm
Confirm transaction (Organizer only)

**Headers:**
- `Authorization: Bearer <token>`

### PUT /transactions/:id/reject
Reject transaction (Organizer only)

**Headers:**
- `Authorization: Bearer <token>`

---

## Reviews

### GET /events/:eventId/reviews
Get reviews for an event

**Response:**
```json
[
  {
    "id": 1,
    "rating": 5,
    "comment": "Great event!",
    "user": {...},
    "createdAt": "..."
  }
]
```

### POST /events/:eventId/reviews
Create review (Customer only, requires completed transaction)

**Headers:**
- `Authorization: Bearer <token>`

**Body:**
```json
{
  "rating": 5,
  "comment": "Amazing event!"
}
```

**Requirements:**
- User must have a completed transaction for this event
- Event must have ended

### GET /organizers/:organizerId/profile
Get organizer profile with reviews and ratings

---

## Transaction Status Flow

1. **WAITING_PAYMENT** - Transaction created, waiting for payment proof upload (2 hours deadline)
2. **WAITING_CONFIRMATION** - Payment proof uploaded, waiting for organizer confirmation (3 days deadline)
3. **DONE** - Transaction confirmed by organizer
4. **REJECTED** - Transaction rejected by organizer (seats/points/voucher/coupon restored)
5. **EXPIRED** - Payment proof not uploaded within 2 hours (auto, seats/points/voucher/coupon restored)
6. **CANCELLED** - Organizer didn't confirm/reject within 3 days (auto, seats/points/voucher/coupon restored)

---

## Auto Jobs

Set up cron jobs to run:
- `expireTransactions()` - Every 5 minutes
- `cancelTransactions()` - Every hour

See `src/jobs/transaction-jobs.ts` for implementation.
