# Wallet connection guide and compatibility

Reviewed 23 September 2026. These are supported protocol paths, checked against
published provider behavior and local signed-wallet fixtures. They are **not live
certification** of an account, relay or Lightning payment with each service.

## Which connection is easiest?

| Wallet/service | Connection to Nostr WoT | Setup effort |
|---|---|---|
| Alby Hub | Create an app connection, grant the desired permissions, paste its NWC secret into the NWC tab. | Easiest if you already have a running, funded Hub. Starting a Hub is a separate setup. |
| LNbits | Enable NWC Provider, create a wallet connection and paste its pairing URI. Alternatively use the LNbits tab with the instance URL and that wallet's Admin API key. | Easy when the provider extension is already enabled; otherwise requires the instance administrator. |
| YakiHonne | Copy/export the NWC connection secret from an available YakiHonne wallet and paste it into the NWC tab. YakiHonne can also use the extension's WebLN provider. | Straightforward with an existing wallet/secret; new-wallet availability depends on the service. |
| BTCPay Server | Use an NWC provider attached to a suitable Lightning backend, then create a separate connection for Nostr WoT. | Most involved if you only have BTCPay. Its standard Nostr plugin consumes an NWC connection; it does not issue one. |
| Generic NWC | Paste a valid `nostr+walletconnect://` URI issued by a compatible wallet. | As easy as the wallet's connection setup. Available operations depend on its permissions. |

For the shortest path, use the NWC secret from a wallet you already operate.
Alby Hub's app-connection screen is a convenient option. For an existing LNbits
wallet, NWC provides per-connection permissions/budgets; the direct API path needs
fewer NWC components but uses the wallet's spending API credential.

## NWC setup

1. In the wallet, create an app connection specifically for Nostr WoT.
2. Enable wallet information (`get_info`), which the extension uses to validate
   the connection before saving it. Enable balance, payments, invoices, invoice
   lookup and transaction history according to what you want to use. A wallet may
   omit optional operations or deny them because of its permissions.
3. Set an appropriate spending budget and expiry if the wallet offers these.
4. Copy the entire connection URI into **Wallet → NWC** and connect. Treat this
   URI as a credential; never post it in an issue or screenshot.
5. If an operation fails, check connection permissions and expiry in the wallet.
   If a payment outcome is unknown, check wallet history before starting another.

Official setup guides:

- [Alby Hub app connections](https://guides.getalby.com/user-guide/alby-hub/app-connections)
- [LNbits NWC Provider](https://docs.lnbits.com/extensions/nwcprovider/)
- [LNbits API keys and where to find them](https://docs.lnbits.com/api/authentication#finding-your-keys)
- [BTCPay Lightning connection options](https://docs.btcpayserver.org/LightningNetwork/)
- [BTCPay Nostr plugin](https://docs.btcpayserver.org/Nostr/)

## What is the LNbits Admin API key?

It is **not your LNbits administrator login password**. It is the API credential
for the specific LNbits wallet, found in that wallet's API information. The Admin
key can spend from that wallet; the invoice/read key cannot perform outgoing
payments. Enter the LNbits instance URL and wallet Admin API key in the LNbits
tab. To use an NWC pairing URI instead, choose the NWC tab.

## Provider behavior covered

The extension uses the same NIP-47 implementation for all NWC connections; it
never selects a different cryptographic path based on a wallet brand.
Compatibility regressions cover Alby's nullable restricted alias and nullable
unsettled timestamps, plus LNbits' nullable history fields and signed fees. The
YakiHonne consumer-contract test calls the actual injected `enable()` and
`sendPayment()` APIs, requires user approval, and returns the expected preimage.

Source references inspected:

- [Alby Hub implementation](https://github.com/getAlby/hub/tree/bc6e57beaec17a835b2d39b6c6cee41eeb0be872)
- [LNbits NWC Provider implementation](https://github.com/lnbits/nwcprovider/tree/b3500f63d9cf5c6f1652388b4cca96d92269d7a1)
- [YakiHonne wallet creation and secret export](https://github.com/YakiHonne/web-app/blob/58aa6af3dcd03d391ce6ba525c4c896a5f1f2b45/src/Components/AddYakiWallet.js)
- [YakiHonne WebLN consumer](https://github.com/YakiHonne/web-app/blob/58aa6af3dcd03d391ce6ba525c4c896a5f1f2b45/src/Hooks/useLightningWallets.js)
- [NIP-47 specification](https://github.com/nostr-protocol/nips/blob/master/47.md)

See [the audit](nwc-audit.md) for wire-protocol tests, encryption negotiation,
connection lifetime and payment replay safeguards, and their limits. A live
acceptance check still needs a user-owned, limited-budget connection from each
provider; automated tests do not move real funds.
