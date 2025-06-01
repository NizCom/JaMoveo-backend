import { Server } from "socket.io";
import http from "http";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import bcrypt from "bcryptjs";
import { generateToken } from "./utils/authentication.js";
import { insertNewMusician, findMusician } from "./utils/db.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const app = express();
const allowedOrigin = process.env.FRONTEND_URL || "http://localhost:5173";
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigin, methods: ["GET", "POST"] },
});
const PORT = 5000;

app.use(cors());
app.use(express.json());

let currentSong = null;

// register user
app.post("/signup", async (req, res) => {
  const { username, password, instrument, role = "player" } = req.body;

  const validationResult = await validateSignupData(req.body, res);
  if (!validationResult.valid) {
    return res.status(400).json({ message: validationResult.message });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const inserted = await insertNewMusician({
      username,
      password: hashedPassword,
      instrument,
      role,
    });

    if (!inserted) {
      throw new Error("Failed to register user");
    }

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Error inserting new musician:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// user login
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const validationResult = await validateLoginData(req.body, res);
  if (!validationResult.valid) {
    return res.status(400).json({ message: validationResult.message });
  }
  const token = generateToken({ username });

  const user = validationResult.message;
  res.status(200).json({
    message: "Login successful",
    token,
    user: {
      username: user.username,
      role: user.role,
      instrument: user.instrument,
    },
  });
});

app.get("/songs", async (req, res) => {
  const { name } = req.query;
  if (!name) {
    return res.status(400).json({
      error: "Song name parameter is required",
    });
  }
  const songsDir = path.join(process.cwd(), "songs");

  try {
    const files = await fs.readdir(songsDir);
    const songs = [];
    const matchingFiles = files.filter(
      (file) =>
        file.endsWith(".json") &&
        file.toLowerCase().includes(name.toLowerCase())
    );

    for (const file of matchingFiles) {
      try {
        const filePath = path.join(songsDir, file);
        const fileContent = await fs.readFile(filePath, "utf8");
        const songData = JSON.parse(fileContent);

        const song = {
          songName: path.basename(file, ".json").replaceAll("_", " ") || null,
          artist: songData.artist || songData.performer || null,
          image: songData.image || songData.artwork || songData.cover || null,
        };

        songs.push(song);
      } catch (parseError) {
        console.error(`Error parsing file ${file}:`, parseError.message);
      }
    }

    res.json({
      searchTerm: name,
      count: songs.length,
      songs: songs,
    });
  } catch (error) {
    console.error("Error reading songs directory:", error);
    res.status(500).json({ error: "Failed to read songs" });
  }
});

app.get("/song", async (req, res) => {
  const { name } = req.query;
  console.log("Received song request for:", name);
  if (!name) {
    return res.status(400).json({ error: "Song name parameter is required" });
  }

  const songsDir = path.join(process.cwd(), "songs");
  try {
    const files = await fs.readdir(songsDir);
    // Find the file that matches the song name (case-insensitive, underscores/spaces ignored)
    const fileName = files.find(
      (file) =>
        file.endsWith(".json") &&
        path.basename(file, ".json").replace(/_/g, " ").toLowerCase() ===
          name.toLowerCase()
    );

    if (!fileName) {
      return res.status(404).json({ error: "Song not found" });
    }

    const filePath = path.join(songsDir, fileName);
    const fileContent = await fs.readFile(filePath, "utf8");
    const songData = JSON.parse(fileContent);
    const { lyrics, chords } = extractLyricsAndChords(songData);

    const song = {
      songName: path.basename(fileName, ".json"),
      artist: songData.artist || songData.performer || null,
      image: songData.image || songData.artwork || songData.cover || null,
      lyrics: lyrics,
      chords: chords,
    };

    currentSong = song; // Store the current song globally

    res.json({ song });
  } catch (error) {
    console.error("Error fetching song:", error);
    res.status(500).json({ error: "Failed to fetch song" });
  }
});

app.get("/current-song", (req, res) => {
  if (currentSong) {
    res.json({ song: currentSong });
  } else {
    res.status(404).json({ song: null });
  }
});

// Sockets
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("startLivePage", (song) => {
    // Broadcast to all clients except sender
    console.log(
      "Received startLivePage signal from:",
      socket.id,
      "with song data:",
      song
    );
    socket.broadcast.emit("startLivePage", song); // Notify all clients
  });

  socket.on("quitSession", () => {
    currentSong = null; // Clear the current song
    io.emit("quitSession"); // Notify all clients
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected:", socket.id);
  });
});

const DEPLOYMENT_PORT = process.env.PORT || 5000;

server.listen(DEPLOYMENT_PORT, "0.0.0.0", () => {
  // Bind to 0.0.0.0 for all network interfaces
  console.log(`Server running on port ${DEPLOYMENT_PORT}`);
  // In production, the URL won't be localhost, but the Render domain
  console.log(
    `Server accessible at: ${
      process.env.RENDER_EXTERNAL_URL || `http://localhost:${DEPLOYMENT_PORT}`
    }`
  );
});

// HELPERS

const validateSignupData = async (data, res) => {
  const { username, password, instrument } = data;

  // checks if one of the fields is missing
  if (!username || !password || !instrument) {
    return {
      valid: false,
      message: "Username, password, and instrument are required.",
    };
  }

  // checks if username is already in use
  const user = await findMusician(username);

  if (user) {
    return {
      valid: false,
      message: "Username is already in use",
    };
  }

  return { valid: true };
};

const validateLoginData = async (data, res) => {
  const { username, password } = data;

  // checks if one of the fields is missing
  if (!username || !password) {
    return {
      valid: false,
      message: "Username and password are required",
    };
  }

  // checks if username exists
  const user = await findMusician(username);

  if (!user) {
    return {
      valid: false,
      message: "Sorry, we don't recognize this username",
    };
  }

  const isMatch = bcrypt.compare(password, user.password);

  if (!isMatch) {
    return {
      valid: false,
      message: "Invalid password",
    };
  }

  return { valid: true, message: user };
};

function extractLyricsAndChords(songArray) {
  const flat = songArray.flat();
  const lyrics = flat.map((item) => item.lyrics || "");
  const chords = flat.map((item) => item.chords || "");
  return { lyrics, chords };
}
