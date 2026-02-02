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
const Account = require('./models/Account');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Kết nối Database
connectDB();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. Cấu hình Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret_key_bat_ky',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 giờ
}));

// 2. Middleware sửa lỗi bảo mật (CSP) để load font và icon
app.use((req, res, next) => {
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; " +
        "font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com; " +
        "img-src 'self' data: https:; " +
        "connect-src 'self'"
    );
    next();
});

// const storage = multer.diskStorage({
//     destination: (req, file, cb) => cb(null, 'public/uploads/'),
//     filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
// });
// const upload = multer({ storage });
// --- Code mới (THÊM VÀO) ---
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Cấu hình Cloudinary (Lấy từ Dashboard của Cloudinary)
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'order-app-menu', // Tên thư mục trên Cloudinary
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    },
});

const upload = multer({ storage: storage });
// --- MIDDLEWARE PHÂN QUYỀN ---
const authorize = (roles) => {
    return (req, res, next) => {
        if (req.session.user && roles.includes(req.session.user.role)) {
            return next();
        }
        res.redirect('/login.html');
    };
};

app.use(express.static('public'));

// 3. Cấu hình đường dẫn cho thư mục PRIVATE
app.get('/private/quan-ly.html', authorize(['admin']), (req, res) => {
    res.sendFile(path.join(__dirname, 'private', 'quan-ly.html'));
});

app.get('/private/bep-bar.html', authorize(['admin', 'kitchen']), (req, res) => {
    res.sendFile(path.join(__dirname, 'private', 'bep-bar.html'));
});

app.get('/private/nhan-vien.html', authorize(['admin', 'staff']), (req, res) => {
    res.sendFile(path.join(__dirname, 'private', 'nhan-vien.html'));
});

app.use('/private', (req, res, next) => {
    if(req.session.user) next(); else res.redirect('/login.html');
}, express.static('private'));


// --- ROUTES API ---

// Đăng nhập
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await Account.findOne({ username, password });
        if (user) {
            req.session.user = {
                id: user._id,
                username: user.username,
                role: user.role
            };
            return res.json({ success: true, role: user.role });
        }
        res.json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu!' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// Đăng xuất
app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login.html');
});

// Tạo tài khoản (Chỉ Admin)
app.post('/api/admin/create-account', authorize(['admin']), async (req, res) => {
    try {
        const { username, password, role, fullName } = req.body;
        const exist = await Account.findOne({ username });
        if (exist) return res.json({ success: false, message: 'Tài khoản đã tồn tại!' });

        const newAcc = new Account({ username, password, role, fullName });
        await newAcc.save();
        res.json({ success: true, message: 'Tạo tài khoản thành công!' });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// API Lấy sản phẩm cho khách
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find({ 
            isVisible: true, 
            category: { $in: ['Drink', 'Snack'] } 
        });
        res.json(products);
    } catch (err) { res.status(500).send(err.message); }
});

// API Lấy sản phẩm cho Admin
app.get('/api/admin/products', authorize(['admin', 'staff']), async (req, res) => {
    try {
        const products = await Product.find({});
        res.json(products);
    } catch (err) { res.status(500).send(err.message); }
});

// API Đơn hàng pending theo bàn
app.get('/api/orders/pending/:table', authorize(['admin', 'staff']), async (req, res) => {
    try {
        const order = await Order.findOne({ tableNumber: req.params.table, status: 'pending' });
        res.json(order || null);
    } catch (err) { res.status(500).send(err.message); }
});

// API Tất cả đơn cho bếp (Lấy cả đơn chưa thanh toán VÀ đơn đã thanh toán nhưng chưa làm xong)
// API Tất cả đơn hàng đang chờ xử lý (chưa thanh toán)
app.get('/api/orders/pending-all', authorize(['admin', 'kitchen', 'staff']), async (req, res) => {
    try {
        // Lấy tất cả các đơn hàng có trạng thái 'pending' (chưa thanh toán)
        const orders = await Order.find({ 
            status: 'pending' 
        });
        res.json(orders);
    } catch (err) { res.status(500).send(err.message); }
});
// API Thêm/Sửa món
app.post('/api/products', authorize(['admin']), upload.single('image'), async (req, res) => {
    try {
        const { id, name, price, category } = req.body;
        // const image = req.file ? `/uploads/${req.file.filename}` : undefined;
        const image = req.file ? req.file.path : undefined;
        if (id) {
            const updateData = { name, price, category };
            if (image) updateData.image = image;
            await Product.findByIdAndUpdate(id, updateData);
        } else {
            const newProduct = new Product({ name, price, image: image || '', category });
            await newProduct.save();
        }
        res.redirect('/private/quan-ly.html');
    } catch (err) { res.status(500).send(err.message); }
});

// API Thống kê doanh thu
app.get('/api/stats/revenue', authorize(['admin']), async (req, res) => {
    try {
        const { type, year, month } = req.query; 
        let matchStage = { status: 'paid' };
        let groupStage = {};
        
        const currYear = parseInt(year) || new Date().getFullYear();
        const currMonth = parseInt(month) || new Date().getMonth() + 1;

        if (type === 'daily') {
            const start = new Date(currYear, currMonth - 1, 1);
            const end = new Date(currYear, currMonth, 0, 23, 59, 59);
            matchStage.createdAt = { $gte: start, $lte: end };
            groupStage = { _id: { $dayOfMonth: "$createdAt" }, total: { $sum: "$totalAmount" } };
        } 
        else if (type === 'monthly') {
            const start = new Date(currYear, 0, 1);
            const end = new Date(currYear, 11, 31, 23, 59, 59);
            matchStage.createdAt = { $gte: start, $lte: end };
            groupStage = { _id: { $month: "$createdAt" }, total: { $sum: "$totalAmount" } };
        } 
        else if (type === 'yearly') {
            groupStage = { _id: { $year: "$createdAt" }, total: { $sum: "$totalAmount" } };
        }

        const data = await Order.aggregate([
            { $match: matchStage },
            { $group: groupStage },
            { $sort: { _id: 1 } }
        ]);
        res.json(data);
    } catch (err) { res.status(500).send(err.message); }
});

// API Ẩn/Hiện món
app.post('/api/products/toggle/:id', authorize(['admin']), async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (product) {
            product.isVisible = !product.isVisible;
            await product.save();
            res.json({ success: true, isVisible: product.isVisible });
        } else { res.status(404).json({ success: false }); }
    } catch (err) { res.status(500).json({ success: false }); }
});

// API Xóa món
app.delete('/api/products/:id', authorize(['admin']), async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// API Lịch sử đơn
app.get('/api/orders/history', authorize(['admin']), async (req, res) => {
    try {
        const orders = await Order.find({ status: 'paid' }).sort({ createdAt: -1 }).limit(50);
        res.json(orders);
    } catch (err) { res.status(500).send(err.message); }
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    
    // 1. Gửi đơn hàng
    socket.on('send_order', async (data) => {
        try {
            if (data.isTakeAway) data.tableNumber = "0";
            let order = await Order.findOne({ tableNumber: data.tableNumber, status: 'pending' });

            if (order) {
                data.items.forEach(newItem => {
                    const exist = order.items.find(i => i.productName === newItem.productName);
                    if (exist) exist.quantity += newItem.quantity;
                    else order.items.push(newItem);
                });
                order.items = order.items.filter(i => i.quantity > 0);
                if (order.items.length === 0) {
                    await Order.findByIdAndDelete(order._id);
                    order = { _id: order._id, tableNumber: data.tableNumber, status: 'deleted', items: [] };
                } else {
                    order.totalAmount = order.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
                    if (data.notes) order.notes = data.notes;
                    await order.save();
                }
            } else {
                if (data.items.length > 0) {
                    const realTotal = data.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
                    order = new Order({
                        tableNumber: data.tableNumber,
                        items: data.items,
                        totalAmount: realTotal,
                        notes: data.notes || '',
                        isTakeAway: data.isTakeAway,
                        status: 'pending',
                        kitchenDone: false
                    });
                    await order.save();
                }
            }
            if(order) io.emit('new_order_to_admin', order);
        } catch (e) { console.error(e); }
    });

    // 2. Thanh toán
    socket.on('pay_order', async (data) => {
        try {
            const update = { status: 'paid', paidAt: new Date() };
            if (data.invoiceCode) update.invoiceCode = data.invoiceCode;
            if (data.notes) update.notes = data.notes;

            const order = await Order.findOneAndUpdate(
                { tableNumber: data.tableNumber, status: 'pending' },
                update,
                { new: true }
            );
            if (order) io.emit('order_paid_success', order);
        } catch (e) { console.error(e); }
    });

    // 3. Bếp báo đã làm xong món (Đã được đưa vào đúng chỗ)
    socket.on('kitchen_finish', async (data) => {
        try {
            const order = await Order.findByIdAndUpdate(
                data.orderId,
                { kitchenDone: true }, 
                { new: true }
            );
            if (order) io.emit('kitchen_finish_success', order);
        } catch (e) { console.error(e); }
    });

}); // <--- Kết thúc khối io.on ở đây là đúng

// Seed Admin Mặc định
const seedAdmin = async () => {
    try {
        const adminExists = await Account.findOne({ role: 'admin' });
        if (!adminExists) {
            await Account.create({
                username: 'admin',
                password: '123',
                role: 'admin',
                fullName: 'Quản trị viên'
            });
            console.log('✅ Đã tạo tài khoản admin mặc định: admin / 123');
        }
    } catch (err) { console.error('Lỗi seed admin:', err); }
};
seedAdmin();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server chạy tại http://localhost:${PORT}`));