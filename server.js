const express = require("express");
const bodyParser = require("body-parser");
const oracledb = require("oracledb");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
const PORT = 5000;

// Enable CORS for all origins (for development purposes)
app.use(cors());
app.use(bodyParser.json());

// Oracle Database Connection Configuration
async function initializeDB() {
  try {
    const dbURI = process.env.ORACLE_DB_URI;
    await oracledb.createPool({
      user: "system", // Oracle database username
      password: "rupa", // Oracle database password
      connectString: "localhost/XE", // Replace with your TNS alias or connection string
    });
    console.log("Connected to database");
  } catch (err) {
    console.error("Error connecting to database:", err);
    process.exit(1); // Exit if the database connection fails
  }
}

initializeDB();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Ensure this folder exists
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

// Create a folder to store uploaded files if it doesn't exist
const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Send verification email function
const sendVerificationEmail = async (recipientEmail, subject, message) => {
  try {
    // Set up the transporter for sending emails
    const transporter = nodemailer.createTransport({
      service: "gmail", // Use your email service (e.g., Gmail, Outlook, etc.)
      auth: {
        user: process.env.EMAIL_USER, // Your email address (stored in .env file)
        pass: process.env.EMAIL_PASS, // App password or email password
      },
    });

    // Define the email options
    const mailOptions = {
      from: process.env.EMAIL_USER, // Sender email address
      to: recipientEmail,           // Recipient email address
      subject: subject,             // Email subject
      text: message,                // Email body (plaintext)
    };

    // Send the email
    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully");
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
};

// Admin login route
app.post("/admin/login", (req, res) => {
  const { email, password } = req.body;

  // Example admin credentials (this would usually come from a database)
  const adminCredentials = { email: "admin@example.com", password: "admin123" };

  // Check if the email and password match
  if (email === adminCredentials.email && password === adminCredentials.password) {
    // Generate a JWT token for the admin
    const token = jwt.sign({ email: adminCredentials.email }, "secretKey", { expiresIn: "1h" });

    res.status(200).json({ token });
  } else {
    res.status(401).json({ message: "Invalid credentials" });
  }
});

//register
app.post("/register", async (req, res) => {
  const { name, mobileNumber, password, village, district, state } = req.body;

  try {
    const connection = await oracledb.getConnection();

    // Check if the user already exists
    const checkSql = "SELECT id FROM users WHERE mobileNumber = :mobileNumber";
    const checkResult = await connection.execute(checkSql, { mobileNumber });

    if (checkResult.rows.length > 0) {
      res.status(400).send({ message: "User already exists" });
      await connection.close();
      return;
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user into the database
    const insertSql = `
      INSERT INTO users (id, name, mobileNumber, password, village, district, state) 
      VALUES (user_seq.NEXTVAL, :name, :mobileNumber, :password, :village, :district, :state)`;
    await connection.execute(
      insertSql,
      { name, mobileNumber, password: hashedPassword, village, district, state },
      { autoCommit: true }
    );

    res.status(201).send({ message: "User registered successfully" });
    await connection.close();
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).send({ message: "Registration failed", error });
  }
});


// Login User
app.post("/login", async (req, res) => {
  const { mobileNumber, password } = req.body;

  try {
    const connection = await oracledb.getConnection();

    // Fetch user from database
    const sql = "SELECT id, password FROM users WHERE mobileNumber = :mobileNumber";
    const result = await connection.execute(sql, { mobileNumber });

    if (result.rows.length === 0) {
      res.status(404).send({ message: "User not found" });
      await connection.close();
      return;
    }

    const [userId, hashedPassword] = result.rows[0];
    
    // Compare the hashed password
    const match = await bcrypt.compare(password, hashedPassword);
    if (match) {
      // Generate a JWT token
      const token = jwt.sign({ id: userId }, process.env.JWT_SECRET_KEY, { expiresIn: "1h" });
      res.status(200).send({ message: "Login successful", token });
    } else {
      res.status(401).send({ message: "Incorrect password" });
    }

    await connection.close();
  } catch (error) {
    console.error("Error logging in user:", error);
    res.status(500).send({ message: "Login failed", error });
  }
});

// Reset Password
app.post("/reset-password", async (req, res) => {
  const { mobileNumber, newPassword } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const connection = await oracledb.getConnection();
    const sql = "UPDATE users SET password = :password WHERE mobileNumber = :mobileNumber";
    await connection.execute(sql, { password: hashedPassword, mobileNumber }, { autoCommit: true });
    res.status(200).send({ message: "Password reset successfully" });
    await connection.close();
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).send({ message: "Error resetting password", error });
  }
});

// Verify User Route
app.put("/verify/:id", async (req, res) => {
  const userId = req.params.id;
  const verifiedStatus = req.body.verified;

  try {
    const connection = await oracledb.getConnection();

    // Update the user's verification status in the database
    const result = await connection.execute(
      `UPDATE users SET verified = :verifiedStatus WHERE id = :userId`,
      { verifiedStatus, userId },
      { autoCommit: true }
    );

    if (result.rowsAffected === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "User verified successfully!" });
    await connection.close();
  } catch (error) {
    console.error("Error verifying user:", error);
    res.status(500).json({ message: "Error verifying user." });
  }
});

// AgriConnect Registration Form Submission
app.post(
  "/agriconnect",
  upload.fields([{ name: "identityProof" }, { name: "additionalProof" }]),
  async (req, res) => {
    const { name, email, phone, role } = req.body;
    const identityProof = req.files["identityProof"]
      ? req.files["identityProof"][0].path
      : null;
    const additionalProof = req.files["additionalProof"]
      ? req.files["additionalProof"][0].path
      : null;

    // Input validation
    if (!name || !email || !phone || !role || !identityProof) {
      return res.status(400).json({
        message: "All fields are required, especially identity proof.",
      });
    }

    try {
      // Connect to Oracle Database
      const connection = await oracledb.getConnection();

      // Insert form data into the database
      const result = await connection.execute(
        `INSERT INTO agriconnect_users (name, email, phone, role, identity_proof, additional_proof) 
         VALUES (:name, :email, :phone, :role, :identityProof, :additionalProof)`,
        {
          name: name,
          email: email,
          phone: phone,
          role: role,
          identityProof: identityProof,
          additionalProof: additionalProof,
        },
        { autoCommit: true }
      );

      // Send verification email after successful registration
      const verificationMessage = `Hello ${name}, your AgriConnect registration has been successfully submitted. Please check your email for further instructions.`;
      await sendVerificationEmail(email, "AgriConnect Registration", verificationMessage);

      // Close the database connection
      await connection.close();

      res.status(200).json({
        message: "Registration successful. Data stored in the database.",
      });
    } catch (error) {
      console.error("Database Error:", error);
      res.status(500).json({
        message: "An error occurred while storing the data.",
      });
    }
  }
);

// New code to add (from your provided code)
// Fetch all submissions from the database
app.get("/submissions", async (req, res) => {
  try {
    const connection = await oracledb.getConnection();
    
    // Query to fetch all submissions from the agriconnect_users table
    const sql = `SELECT id, name, phone, role, identity_proof, additional_proof, verification_status 
                 FROM agriconnect_users`;

    const result = await connection.execute(sql);
    
    // Map result rows to the expected format for submissions
    const submissions = result.rows.map((row) => ({
      id: row[0],
      name: row[1],
      mobile: row[2],
      role: row[3], // role is now correctly mapped
      idProof: row[4] ? `/uploads/${row[4]}` : null, // Ensure the path is valid and prefixed with `/uploads/`
      additionalProof: row[5] ? `/uploads/${row[5]}` : null, // Same for additionalProof
      status: row[6], // verification_status
    }));

    await connection.close();

    res.json(submissions);
  } catch (error) {
    console.error("Error fetching submissions:", error);
    res.status(500).json({ message: "Error fetching submissions" });
  }
});

// Approve a submission
app.post("/submissions/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const connection = await oracledb.getConnection();
    
    // Update verification_status to 'approved' in the database
    const sql = `UPDATE agriconnect_users SET verification_status = :status WHERE id = :id`;
    const result = await connection.execute(sql, { status: "approved", id }, { autoCommit: true });

    if (result.rowsAffected === 0) {
      res.status(404).send({ message: "Submission not found" });
    } else {
      res.send({ message: "Submission approved!" });
    }

    await connection.close();
  } catch (error) {
    console.error("Error approving submission:", error);
    res.status(500).json({ message: "Error approving submission" });
  }
});

// Reject a submission
app.post("/submissions/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const connection = await oracledb.getConnection();

    // Update verification_status to 'rejected' in the database
    const sql = `UPDATE agriconnect_users SET verification_status = :status WHERE id = :id`;
    const result = await connection.execute(sql, { status: "rejected", id }, { autoCommit: true });

    if (result.rowsAffected === 0) {
      res.status(404).send({ message: "Submission not found" });
    } else {
      res.send({ message: "Submission rejected!" });
    }

    await connection.close();
  } catch (error) {
    console.error("Error rejecting submission:", error);
    res.status(500).json({ message: "Error rejecting submission" });
  }
});

// Endpoint to fetch username by mobile number
app.get("/getUser", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const connection = await oracledb.getConnection();

    const sql = "SELECT name FROM users WHERE id = :id";
    const result = await connection.execute(sql, { id: decoded.id });

    if (result.rows.length > 0) {
      const userName = result.rows[0][0];
      console.log("Fetched username:", userName); // Debug log
      res.status(200).json({ name: userName });
    } else {
      res.status(404).json({ message: "User not found" });
    }

    await connection.close();
  } catch (error) {
    console.error("Error fetching user details:", error);
    res.status(500).json({ message: "Error fetching user details" });
  }
});

// Start server
app.listen(process.env.PORT, () => {
  console.log(`Server Started at port ${process.env.PORT}`);
});
