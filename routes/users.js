var express = require("express");
var router = express.Router();
let { CreateUserValidator, validationResult } = require('../utils/validatorHandler')
let userModel = require("../schemas/users");
let userController = require('../controllers/users')
let { CheckLogin, CheckRole } = require('../utils/authHandler')
let { uploadExcel } = require('../utils/uploadHandler');
let exceljs = require('exceljs');
let path = require('path');
let fs = require('fs');
let roleModel = require('../schemas/roles');
let { sendPasswordMail } = require('../utils/mailHandler');
let crypto = require('crypto');
router.post('/import', uploadExcel.single('file'), async function(req, res, next) {
    if (!req.file) {
        return res.status(400).send({ message: "file khong duoc rong" });
    }

    try {
        let workBook = new exceljs.Workbook();
        let filePath = path.join(__dirname, '../uploads', req.file.filename);
        await workBook.xlsx.readFile(filePath);
        let worksheet = workBook.worksheets[0];
        let result = [];

        let roleUser = await roleModel.findOne({ name: { $in: ['USER', 'user'] } });
        if (!roleUser) {
            roleUser = new roleModel({ name: 'USER', description: 'Automatically created for imported users' });
            await roleUser.save();
        }

        let users = await userModel.find({});
        let existingUsernames = users.map(u => u.username);
        let existingEmails = users.map(u => u.email);

        for (let index = 2; index <= worksheet.rowCount; index++) {
            let row = worksheet.getRow(index);
            let username = row.getCell(1).value;
            let email = row.getCell(2).value;

            // Xử lý object Excel (Hyperlink, Formula, text thường)
            if (username && typeof username === 'object') {
                if (username.result) username = username.result;
                else if (username.text) username = username.text;
            }
            if (email && typeof email === 'object') {
                if (email.result) email = email.result;
                else if (email.text) email = email.text;
            }

            // Gán giá trị rỗng nếu undefined
            username = username ? String(username).trim() : '';
            email = email ? String(email).trim() : '';

            let rowErrors = [];
            if (!username) rowErrors.push("username rong");
            if (!email) rowErrors.push("email rong");
            if (existingUsernames.includes(username)) rowErrors.push("username da ton tai");
            if (existingEmails.includes(email)) rowErrors.push("email da ton tai");

            if (rowErrors.length > 0) {
                result.push({ row: index, success: false, data: rowErrors });
                continue;
            }

            let randomPassword = crypto.randomBytes(8).toString('hex'); // 16 chars long

            try {
                let newUser = new userModel({
                    username: username,
                    email: email,
                    password: randomPassword,
                    role: roleUser._id
                });
                await newUser.save();
                existingUsernames.push(username);
                existingEmails.push(email);

                await sendPasswordMail(email, randomPassword);

                result.push({ row: index, success: true, data: { username, email } });
            } catch (err) {
                result.push({ row: index, success: false, data: err.message });
            }
        }
        
        fs.unlinkSync(filePath);
        res.send(result);
    } catch (err) {
        if (req.file) fs.unlinkSync(path.join(__dirname, '../uploads', req.file.filename));
        res.status(500).send({ message: err.message });
    }
});


router.get("/", CheckLogin, CheckRole("ADMIN", "MODERATOR"), async function (req, res, next) {
  let users = await userModel
    .find({ isDeleted: false })
    .populate({
      path: 'role',
      select: 'name'
    })
  res.send(users);
});

router.get("/:id",CheckLogin,CheckRole("ADMIN"), async function (req, res, next) {
  try {
    let result = await userModel
      .find({ _id: req.params.id, isDeleted: false })
    if (result.length > 0) {
      res.send(result);
    }
    else {
      res.status(404).send({ message: "id not found" });
    }
  } catch (error) {
    res.status(404).send({ message: "id not found" });
  }
});

router.post("/", CreateUserValidator, validationResult, async function (req, res, next) {
  try {
    let newItem = await userController.CreateAnUser(
      req.body.username, req.body.password, req.body.email, req.body.role
    )
    res.send(newItem);
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

router.put("/:id", async function (req, res, next) {
  try {
    let id = req.params.id;
    let updatedItem = await
      userModel.findByIdAndUpdate(id, req.body, { new: true });

    if (!updatedItem) return res.status(404).send({ message: "id not found" });

    let populated = await userModel
      .findById(updatedItem._id)
    res.send(populated);
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

router.delete("/:id", async function (req, res, next) {
  try {
    let id = req.params.id;
    let updatedItem = await userModel.findByIdAndUpdate(
      id,
      { isDeleted: true },
      { new: true }
    );
    if (!updatedItem) {
      return res.status(404).send({ message: "id not found" });
    }
    res.send(updatedItem);
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

module.exports = router;