import { ref, onMounted, onUnmounted } from 'vue'
import { io } from 'socket.io-client'

export function useWebSocket() {
  const DB = ref(null)
  const connected = ref(false)
  const onlineUsers = ref([])
  let socket = null

  function connect() {
    socket = io('/', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 3000,
      reconnectionAttempts: Infinity,
    })

    socket.on('connect', () => {
      connected.value = true
      socket.emit('join', '用户')
    })

    socket.on('disconnect', () => {
      connected.value = false
    })

    socket.on('initData', (data) => {
      DB.value = data
    })

    socket.on('sectionUpdate', (msg) => {
      if (DB.value && msg.section) {
        DB.value[msg.section] = msg.data
      }
    })

    socket.on('userList', (users) => {
      onlineUsers.value = users
    })
  }

  onMounted(() => connect())
  onUnmounted(() => { if (socket) socket.close() })

  return { DB, connected, onlineUsers }
}
