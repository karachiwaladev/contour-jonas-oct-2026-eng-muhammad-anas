// Usage: node notes/cli.js add "buy milk" | node notes/cli.js list
import { add, load } from './store.js';

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'add') console.log(`Added #${add(rest.join(' ')).id}`);
else for (const n of load()) console.log(`#${n.id} ${n.text}`);
