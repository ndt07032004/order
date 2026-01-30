const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    image: { type: String, default: '' },
    isVisible: { type: Boolean, default: true },
    
    // [CẬP NHẬT] Thêm 'Snack' vào danh sách cho phép
    category: { type: String, enum: ['Drink', 'Grocery', 'Snack'], default: 'Drink' }
});

module.exports = mongoose.model('Product', ProductSchema);