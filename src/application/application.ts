import './calcInput'
import './styles/common.css'
// eslint-disable-next-line import/no-unresolved
import { registerSW } from 'virtual:pwa-register'

import { cleanupPeers, sendToAll, socket } from './socket'
import { store, validateCred } from './store'
import { app, sendToElm } from './elm'
import { decrypt, encrypt, validateTransactions } from './transactions'
import { getEncrypted, dbOpenRequest, TRANSACTIONS } from './idb'
import { LOCAL_STORAGE_DEVICE_NAME } from './const'

const updateSW = registerSW({
  onNeedRefresh(): void {
    sendToElm('NeedRefresh')
  },
  onOfflineReady(): void {
    sendToElm('OfflineReady')
  },
})

const handleTransactionsFromElm = ({
  payload,
  doSendToAll = false,
}: {
  payload: unknown
  doSendToAll?: boolean
}): void => {
  if (!validateTransactions(payload)) {
    sendToElm('Toast', "Can't save to database. Wrong data format")
    return
  }
  if (store.cred === null) {
    sendToElm('Toast', "Can't save to database. You are signed out")
    return
  }
  encrypt(payload, store.cred.password).then(
    (encrypted): void => {
      if (store.cred === null) {
        sendToElm('Toast', "Can't save to database. You are signed out")
        return
      }
      const db = dbOpenRequest.result
      const transaction = db.transaction(TRANSACTIONS, 'readwrite')
      const objectStore = transaction.objectStore(TRANSACTIONS)
      const request = objectStore.put({
        id: store.cred.username,
        encrypted,
      })
      if (doSendToAll) {
        request.onsuccess = (): void => {
          sendToElm('Toast', 'Saved')
          if (store.cred === null) {
            sendToElm('Toast', "Can't send saved data. You are signed out")
            return
          }
          sendToAll(encrypted, store.cred.deviceName)
        }
      }
    },
    (error): void => {
      sendToElm(
        'Toast',
        `Can't save to database. Encryption error: ${String(error)}`,
      )
    },
  )
}

app.ports.sendMessage.subscribe(
  ({ tag, payload }: { tag: SentFromElmMsg; payload: unknown }): void => {
    switch (tag) {
      case 'UpdatedTransactions': {
        handleTransactionsFromElm({ payload, doSendToAll: true })
        break
      }
      case 'MergedReceivedTransactions': {
        handleTransactionsFromElm({ payload })
        break
      }
      case 'SignedIn': {
        if (validateCred(payload)) {
          store.cred = payload
          const { password, username, deviceName } = payload
          localStorage.setItem(LOCAL_STORAGE_DEVICE_NAME, deviceName)
          getEncrypted(username)
            .then(async (encrypted): Promise<void> => {
              try {
                const decrypted =
                  encrypted === null
                    ? []
                    : await decrypt({
                        arrayBuffer: encrypted,
                        password,
                      })

                sendToElm('SignInSuccess', decrypted)
                socket.connect()
              } catch (e) {
                sendToElm('WrongPassword')
                return
              }
            })
            .catch((e): void => {
              sendToElm('Toast', `Can't get data from database: ${String(e)}`)
            })
          break
        }
        sendToElm('Toast', 'Sign in Error')
        break
      }
      case 'SignedOut': {
        store.cred = null
        cleanupPeers()
        socket.disconnect()
        break
      }
      case 'RefreshAppClicked': {
        updateSW().then(
          (): void => {
            sendToElm('Toast', 'App updated successfully')
          },
          (error): void => {
            sendToElm('Toast', `Can't update app: ${String(error)}`)
          },
        )
        break
      }
      default: {
        const exhaustiveCheck: never = tag
        return exhaustiveCheck
      }
    }
  },
)
