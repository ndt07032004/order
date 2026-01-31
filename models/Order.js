const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
    tableNumber: { type: String, required: true }, // Số bàn hoặc "Mang Về"
    items: [{
        productName: String,
        price: Number,
        quantity: { type: Number, default: 1 }
    }],
    totalAmount: { type: Number, default: 0 },
    invoiceCode: { type: String, default: '' },
    paidAt: { type: Date },
    // Pending: Khách đang ăn/gọi, Paid: Đã thanh toán xong
    status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
    isTakeAway: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', OrderSchema);