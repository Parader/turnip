# Turnip Game

A web-based game built with Vite + React (JSX) frontend and JavaScript backend.

## Tech Stack

- **Frontend**: Vite, React (JSX), SCSS
- **Backend**: Node.js, Express, MongoDB Atlas
- **Authentication**: bcrypt for password hashing

## Project Structure

```
turnip/
├── apps/
│   ├── client/          # Vite + React frontend
│   │   ├── src/
│   │   │   ├── App.jsx
│   │   │   ├── main.jsx
│   │   │   └── styles/
│   │   ├── index.html
│   │   └── vite.config.js
│   └── server/          # Express backend
│       ├── src/
│       │   ├── config/
│       │   │   └── database.js
│       │   ├── models/
│       │   │   └── User.js
│       │   ├── routes/
│       │   │   └── auth.js
│       │   └── index.js
│       └── .env
```

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn
- MongoDB Atlas account and cluster

### Environment Setup

Create a `.env` file in the `apps/server/` directory with the following:

```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
PORT=3001
```

Replace `username`, `password`, and `cluster` with your MongoDB Atlas credentials.

### Installation

Install all dependencies (client and server):
```bash
npm run install:all
```

Or install individually:
```bash
cd apps/client && npm install
cd ../server && npm install
```

### Development

Start both frontend and backend servers concurrently:
```bash
npm run dev:all
```

Or start individually:
```bash
# Frontend only (runs on http://localhost:3000)
npm run dev:client

# Backend only (runs on http://localhost:3001)
npm run dev:server
```

### Build

Build the frontend for production:
```bash
npm run build
```

The built files will be in `apps/client/dist/`.

## Available Scripts

### Root Level
- `npm run install:all` - Install dependencies for both client and server
- `npm run dev:all` - Start both client and server dev servers concurrently
- `npm run dev:client` - Start only the client dev server
- `npm run dev:server` - Start only the server dev server
- `npm run build` - Build the client for production

### Client (apps/client)
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run clean` - Clean build artifacts

### Server (apps/server)
- `npm run dev` - Start development server with watch mode
- `npm start` - Start production server

## API Endpoints

### General
- `GET /health` - Health check endpoint
- `GET /api/status` - Server status endpoint

### Authentication
- `POST /api/auth/register` - Register a new user
  - Body: `{ "username": "string", "email": "string", "password": "string" }`
  - Returns: User object (without password)
  - Validations:
    - Username must be unique
    - Email must be unique and valid format
    - Password must be at least 6 characters
  
- `POST /api/auth/login` - Login with username or email
  - Body: `{ "identifier": "string", "password": "string" }`
  - Returns: User object (without password)
  - Note: The `identifier` field accepts either username or email

## Database

The application uses MongoDB Atlas with the following configuration:
- **Database**: `turnip`
- **Collection**: `accounts`
- **Unique Indexes**: `username` and `email` (enforced at database level)

