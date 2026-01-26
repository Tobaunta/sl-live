
import { MongoClient } from 'mongodb';

if (!process.env.MONGODB_URI) {
  throw new Error('Invalid/Missing environment variable: "MONGODB_URI"');
}

const uri = process.env.MONGODB_URI;

// Filtrera bort DEP0169 (url.parse deprecation) varningar som kan uppstå 
// i vissa Node-miljöer trots att moderna drivrutiner används.
const originalEmit = process.emit;
// @ts-ignore
process.emit = (name, data, ...args) => {
  if (
    name === 'warning' &&
    typeof data === 'object' &&
    data &&
    data.name === 'DeprecationWarning' &&
    (data.message?.includes('url.parse') || data.message?.includes('DEP0169'))
  ) {
    return false;
  }
  return originalEmit.call(process, name, data, ...args);
};

// Inga extra alternativ behövs för senaste drivrutinen
const options = {};

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

console.log("Initializing MongoDB client...");

if (process.env.NODE_ENV === 'development') {
  let globalWithMongo = globalThis as typeof globalThis & {
    _mongoClientPromise?: Promise<MongoClient>;
  };

  if (!globalWithMongo._mongoClientPromise) {
    client = new MongoClient(uri, options);
    globalWithMongo._mongoClientPromise = client.connect();
  }
  clientPromise = globalWithMongo._mongoClientPromise;
} else {
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
}

export default clientPromise;
