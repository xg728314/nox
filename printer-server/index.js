const net = require("net");
const express = require("express");
const iconv = require("iconv-lite");

const app = express();
app.use(express.json());

const PRINTER_IP = "192.168.0.123";
const PORT = 9100;

function print(text) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();

    client.on("error", (err) => {
      console.error("Printer socket error:", err.message);
      reject(err);
    });

    client.connect(PORT, PRINTER_IP, () => {
      console.log(`Connected to printer ${PRINTER_IP}:${PORT}`);
      const data = iconv.encode(text, "cp949");
      client.write(data);
      client.write(Buffer.from([0x1D, 0x56, 0x00]));
      client.end();
      resolve();
    });
  });
}

app.post("/print", async (req, res) => {
  try {
    const { content } = req.body;
    await print(content);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.listen(3005, () => {
  console.log("Printer server running on 3005");
});