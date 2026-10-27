// Shopping cart maths. Items are {name, price, qty}; prices are in dollars.
export function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}
