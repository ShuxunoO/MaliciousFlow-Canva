import type { CaseData } from './case'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('maliciousflow', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('workspace')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadCase(): Promise<CaseData | undefined> {
  await pendingWrite
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('workspace').objectStore('workspace').get('active')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

let pendingWrite: Promise<void> = Promise.resolve()

export function saveCase(data?: CaseData): Promise<void> {
  const write = pendingWrite.then(() => writeCase(data))
  pendingWrite = write.catch(() => {})
  return write
}

async function writeCase(data?: CaseData): Promise<void> {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('workspace', 'readwrite')
      const store = transaction.objectStore('workspace')
      if (data) store.put(data, 'active')
      else store.delete('active')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}
