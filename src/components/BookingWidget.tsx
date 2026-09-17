import { useState } from 'react';

declare global {
  interface Window {
    Razorpay: any;
  }
}

interface AddOnOption {
  id: string;
  name: string;
  amount: number;
}

interface BookingWidgetProps {
  tourId: string;
  tourTitle: string;
  pricePerTraveler: number;
  currency: string;
  addOns: AddOnOption[];
}

export default function BookingWidget({ tourId, tourTitle, pricePerTraveler, currency, addOns }: BookingWidgetProps) {
  const [date, setDate] = useState('');
  const [travelers, setTravelers] = useState(2);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const addOnsTotal = selectedAddOns.reduce((sum, id) => {
    const addOn = addOns.find((a) => a.id === id);
    return sum + (addOn?.amount ?? 0);
  }, 0);
  const total = pricePerTraveler * travelers + addOnsTotal;

  const toggleAddOn = (id: string) => {
    setSelectedAddOns((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const loadRazorpayScript = (): Promise<boolean> =>
    new Promise((resolve) => {
      if (window.Razorpay) return resolve(true);
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });

  const handleBook = async () => {
    setError(null);

    if (!date) return setError('Please choose a travel date.');
    if (!name || !email || !phone) return setError('Please fill in your name, email, and phone.');

    setLoading(true);
    try {
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) throw new Error('Failed to load payment gateway. Check your connection.');

      // Only the tourId, date, traveler count, and add-on ids are sent — the
      // server is the source of truth for pricing (see src/lib/catalog.ts).
      const orderRes = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tourId,
          date,
          travelers,
          addOnIds: selectedAddOns,
          receipt: `rcpt_${Date.now()}`,
        }),
      });

      if (!orderRes.ok) {
        const { error: msg } = await orderRes.json();
        throw new Error(msg || 'Could not create booking');
      }

      const { orderId, amount, currency: orderCurrency, publicKey } = await orderRes.json();
      if (!publicKey) throw new Error('Payment gateway response was incomplete. Please contact support.');

      const options = {
        key: publicKey,
        amount,
        currency: orderCurrency,
        name: 'IWIS Global',
        description: tourTitle,
        order_id: orderId,
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          const verifyRes = await fetch('/api/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...response,
              travelerName: name,
              travelerEmail: email,
              travelerPhone: phone,
            }),
          });

          if (!verifyRes.ok) {
            const { error: msg } = await verifyRes.json();
            setError(msg || 'Payment verification failed');
            return;
          }

          const { payment_id } = await verifyRes.json();
          setConfirmed(payment_id);
          window.location.href = `/booking/confirmation?payment_id=${payment_id}`;
        },
        modal: { ondismiss: () => setLoading(false) },
        prefill: { name, email, contact: phone },
        theme: { color: '#b45309' },
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (resp: { error: { description: string } }) => {
        setError(resp.error.description || 'Payment failed');
        setLoading(false);
      });
      rzp.open();
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (confirmed) {
    return <p className="text-emerald-700 font-medium">Booking confirmed — payment {confirmed}.</p>;
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Travel date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded border border-stone-300 px-3 py-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Travelers</label>
        <input
          type="number"
          min={1}
          max={12}
          value={travelers}
          onChange={(e) => setTravelers(Math.max(1, Number(e.target.value)))}
          className="w-full rounded border border-stone-300 px-3 py-2"
        />
      </div>

      {addOns.length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-1">Add-ons</label>
          {addOns.map((addOn) => (
            <label key={addOn.id} className="flex items-center gap-2 text-sm py-1">
              <input
                type="checkbox"
                checked={selectedAddOns.includes(addOn.id)}
                onChange={() => toggleAddOn(addOn.id)}
              />
              {addOn.name} (+{currency} {addOn.amount})
            </label>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        <input
          type="text"
          placeholder="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-stone-300 px-3 py-2"
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-stone-300 px-3 py-2"
        />
        <input
          type="tel"
          placeholder="Phone (with country code)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full rounded border border-stone-300 px-3 py-2"
        />
      </div>

      <div className="text-lg font-semibold">
        Total: {currency} {total.toLocaleString('en-IN')}
      </div>

      <button
        onClick={handleBook}
        disabled={loading}
        className="w-full rounded bg-amber-800 text-white py-3 font-medium disabled:opacity-60"
      >
        {loading ? 'Processing…' : 'Book & Pay'}
      </button>

      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
