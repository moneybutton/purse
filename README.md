# @moneybutton/purse

## Description

This is a simple module to fund arbitrary bitcoin transactions using
Invisible Money Button.

## How it works.

``` js
const imb = new moneyButton.imb({ clientIdentifier: '<your_client_identifier>' })
const paymailClient = new PaymailClient()
const purse = new MBPurse(imb, bsv, paymailClient)

const tx = new bsv.Transaction()
tx.to(someAddress, 600)
tx.to(someAddress, 900)

const fundedRawTx = purse.pay(tx.uncheckedSerialize())
console.log(fundedRawTx)
```

If the transaction to fund contains input is necesary to send a second argument with
a list with metadata for the inputs. In particular the amount of satoshis
included in the output spent by every input.

``` js
const imb = new moneyButton.imb({ clientIdentifier: '<your_client_identifier>' })
const paymailClient = new PaymailClient()
const purse = new MBPurse(imb, bsv, paymailClient)

const tx = new bsv.Transaction()
tx.from(new bsv.Transaction.UnspentOutput, {
  txid: 'sometxid',
  vout: 0,
  satoshis: 650
})
tx.from(new bsv.Transaction.UnspentOutput, {
  txid: 'sometxid',
  vout: 0,
  satoshis: 820
})
tx.to(someAddress, 2000)
tx.to(someAddress, 3000)

const fundedRawTx = purse.pay(tx.uncheckedSerialize(), [{ satoshis: 650 }, { satoshis: 820 }]) // the list has a 1-1 match with the inputs.
console.log(fundedRawTx)
```



