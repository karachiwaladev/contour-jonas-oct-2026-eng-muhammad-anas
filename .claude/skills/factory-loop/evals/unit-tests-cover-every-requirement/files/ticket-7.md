# #7 Cart: discount codes

Add `totalWithCode(items, code)` to `cart/cart.js`.

- `SAVE10` takes 10% off the subtotal.
- `HALF` takes 50% off, but never more than $50.
- No code (empty string or undefined) returns the plain subtotal.
- Codes are case-insensitive (`save10` works).
- An unknown code throws an error whose message names the code.
- The result is rounded to 2 decimal places.
