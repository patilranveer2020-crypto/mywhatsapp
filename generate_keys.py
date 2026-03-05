from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
import base64

# Generate a private key
private_key = ec.generate_private_key(ec.SECP256R1())

# Get the public key
public_key = private_key.public_key()

# Get the private key as URL-safe base64 encoded string
private_key_b64 = base64.urlsafe_b64encode(
    private_key.private_numbers().private_value.to_bytes(32, byteorder='big')
).strip(b'=').decode('utf-8')

# Get the public key in uncompressed format
public_key_bytes = public_key.public_bytes(
    encoding=serialization.Encoding.X962,
    format=serialization.PublicFormat.UncompressedPoint
)

# URL-safe base64 encode the public key
public_key_b64 = base64.urlsafe_b64encode(public_key_bytes).strip(b'=').decode('utf-8')

print(f"VAPID_PRIVATE_KEY = '{private_key_b64}'")
print(f"VAPID_PUBLIC_KEY = '{public_key_b64}'")
