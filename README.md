# Dashboard dòng tiền cho hộ kinh doanh

Demo công khai cho dịch vụ dashboard dòng tiền 299.000đ. Dashboard hiển thị vốn, chi phí, doanh thu, lãi/lỗ, số dư và nhật ký theo từng mốc từ dữ liệu thật.

Chi phí Codex được cập nhật từ token log của thread và quy đổi theo giá API Standard công khai. Đây là số ước tính để quản trị vốn, không phải hóa đơn OpenAI đã đối soát.

- Bản demo: https://neverlove149.github.io/so-von-2-trieu/
- Trang dịch vụ: https://neverlove149.github.io/so-von-2-trieu/dich-vu.html
- Excel mẫu miễn phí: https://neverlove149.github.io/so-von-2-trieu/assets/mau-quan-ly-ban-hang-ton-kho.xlsx
- Gửi yêu cầu: https://github.com/neverlove149/so-von-2-trieu/issues/new?template=yeu-cau-dashboard.yml

## Chạy trên máy

```powershell
npm start
```

Mở `http://127.0.0.1:4317/`.

## Cập nhật chi phí API

```powershell
node scripts/update-api-cost.mjs
```

Script cập nhật một dòng chi phí API lũy kế, không cộng trùng giữa các lần chạy.
