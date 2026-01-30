require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const connectDB = require('./config/db');

// Models
const Order = require('./models/Order');
const Product = require('./models/Product');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

connectDB();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

const authAdmin = (req, res, next) => {
    if (req.session.isAdmin) return next();
    // Thay vì báo lỗi 401, ta chuyển hướng người dùng về trang đăng nhập
    res.redirect('/login.html');
};

app.use(express.static('public'));
app.use('/private', authAdmin, express.static('private'));

// --- ROUTES ---

app.post('/api/login', (req, res) => {
    if (req.body.password === process.env.ADMIN_PASS) {
        req.session.isAdmin = true;
        return res.json({ success: true });
    }
    res.json({ success: false, message: 'Sai mật khẩu!' });
});

// API cho Khách (Chỉ hiện Nước)
app.get('/api/products', async (req, res) => {
    try {
        // [CẬP NHẬT] Dùng $in để lấy cả 'Drink' và 'Snack'
        const products = await Product.find({ 
            isVisible: true, 
            category: { $in: ['Drink', 'Snack'] } 
        });
        res.json(products);
    } catch (err) { res.status(500).send(err.message); }
});
// API cho Admin (Hiện Tất cả - ĐỂ QUẢN LÝ MENU)
app.get('/api/admin/products', authAdmin, async (req, res) => {
    try {
        const products = await Product.find({});
        res.json(products);
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/orders/pending/:table', authAdmin, async (req, res) => {
    try {
        const order = await Order.findOne({ tableNumber: req.params.table, status: 'pending' });
        res.json(order || null);
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/orders/pending-all', authAdmin, async (req, res) => {
    try {
        const orders = await Order.find({ status: 'pending', isTakeAway: false });
        res.json(orders);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/products', authAdmin, upload.single('image'), async (req, res) => {
    try {
        const { id, name, price, category } = req.body;
        const image = req.file ? `/uploads/${req.file.filename}` : undefined;

        if (id) {
            // [LOGIC SỬA] Nếu có ID gửi lên -> Cập nhật
            const updateData = { name, price, category };
            if (image) updateData.image = image; // Chỉ cập nhật ảnh nếu user chọn ảnh mới
            await Product.findByIdAndUpdate(id, updateData);
        } else {
            // [LOGIC THÊM] Nếu không có ID -> Tạo mới
            const newProduct = new Product({ name, price, image: image || '', category });
            await newProduct.save();
        }
        res.redirect('/private/quan-ly.html');
    } catch (err) { res.status(500).send(err.message); }
});
app.get('/api/stats/revenue', authAdmin, async (req, res) => {
    try {
        const { type, year, month } = req.query; 
        // type: 'daily' (ngày trong tháng), 'monthly' (tháng trong năm), 'yearly' (các năm)
        
        let matchStage = { status: 'paid' }; // Chỉ tính đơn đã thanh toán
        let groupStage = {};
        
        const currYear = parseInt(year) || new Date().getFullYear();
        const currMonth = parseInt(month) || new Date().getMonth() + 1;

        if (type === 'daily') {
            // Lọc từ ngày 1 đến ngày cuối tháng
            const start = new Date(currYear, currMonth - 1, 1);
            const end = new Date(currYear, currMonth, 0, 23, 59, 59); // Ngày cuối tháng
            matchStage.createdAt = { $gte: start, $lte: end };
            
            // Gom nhóm theo ngày (1-31)
            groupStage = { _id: { $dayOfMonth: "$createdAt" }, total: { $sum: "$totalAmount" } };
        } 
        else if (type === 'monthly') {
            // Lọc cả năm
            const start = new Date(currYear, 0, 1);
            const end = new Date(currYear, 11, 31, 23, 59, 59);
            matchStage.createdAt = { $gte: start, $lte: end };
            
            // Gom nhóm theo tháng (1-12)
            groupStage = { _id: { $month: "$createdAt" }, total: { $sum: "$totalAmount" } };
        } 
        else if (type === 'yearly') {
            // Gom nhóm theo năm
            groupStage = { _id: { $year: "$createdAt" }, total: { $sum: "$totalAmount" } };
        }

        const data = await Order.aggregate([
            { $match: matchStage },
            { $group: groupStage },
            { $sort: { _id: 1 } } // Sắp xếp theo thời gian tăng dần
        ]);
        
        res.json(data);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/products/toggle/:id', authAdmin, async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (product) {
            product.isVisible = !product.isVisible;
            await product.save();
            res.json({ success: true, isVisible: product.isVisible });
        } else { res.status(404).json({ success: false }); }
    } catch (err) { res.status(500).json({ success: false }); }
});

app.delete('/api/products/:id', authAdmin, async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('send_order', async (data) => {
        try {
            // [CẬP NHẬT] Chuẩn hóa: Nếu là Mang Về thì gán Bàn = "0"
            if (data.isTakeAway) {
                data.tableNumber = "0";
            }

            // Luôn tìm đơn đang chờ của bàn đó (kể cả bàn 0) để cộng dồn
            let order = await Order.findOne({ tableNumber: data.tableNumber, status: 'pending' });

            if (order) {
                // Đã có đơn -> Cộng dồn món
                data.items.forEach(newItem => {
                    const exist = order.items.find(i => i.productName === newItem.productName);
                    if (exist) exist.quantity += newItem.quantity;
                    else order.items.push(newItem);
                });
                
                // Lọc bỏ món có số lượng <= 0
                order.items = order.items.filter(i => i.quantity > 0);
                
                // Nếu xóa hết món thì xóa luôn đơn
                if (order.items.length === 0) {
                    await Order.findByIdAndDelete(order._id);
                    // Gửi tín hiệu xóa về client
                    order = { _id: order._id, tableNumber: data.tableNumber, status: 'deleted', items: [] };
                } else {
                    // Tính lại tổng tiền
                    order.totalAmount = order.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
                    await order.save();
                }
            } else {
                // Chưa có đơn -> Tạo mới
                if (data.items.length > 0) {
                    const realTotal = data.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
                    order = new Order({
                        tableNumber: data.tableNumber, // Lúc này đã là "0" nếu là mang về
                        items: data.items,
                        totalAmount: realTotal,
                        isTakeAway: data.isTakeAway,
                        status: 'pending'
                    });
                    await order.save();
                }
            }
            
            // Gửi cập nhật cho Admin
            if(order) io.emit('new_order_to_admin', order);
            
        } catch (e) { console.error(e); }
    });

    socket.on('pay_order', async (data) => {
        try {
            // [QUAN TRỌNG] Khi thanh toán, Server tìm đúng bàn "0" hoặc bàn số để update
            const order = await Order.findOneAndUpdate(
                { tableNumber: data.tableNumber, status: 'pending' },
                { status: 'paid' },
                { new: true }
            );
            if (order) {
                io.emit('order_paid_success', order);
            }
        } catch (e) { console.error(e); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server chạy tại http://localhost:${PORT}`));