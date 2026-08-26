// 中身を空にするだけ
import { client, reset } from './h.js';
await client.connect();
await reset();
await client.end();
console.log('空にした');
