"use client"

/**
 * OrderBlock — Phase A scaffold.
 * visibility: active_expanded.
 * 원본: RoomCardV2 L730-743. 내부적으로 OrderSectionV2 wrap 만 담당.
 */

import { useRoomContext } from "../RoomContext"
import OrderSectionV2 from "../../components/OrderSectionV2"

export default function OrderBlock() {
  const {
    focusData, orderTotal, orderOpen, orderForm, busy, inventoryItems,
    onSetOrderOpen, onSetOrderForm, onAddOrder, onDeleteOrder, onQuickRepeatOrder,
  } = useRoomContext()

  if (!focusData) return null

  return (
    <OrderSectionV2
      orders={focusData.orders}
      orderTotal={orderTotal}
      formOpen={orderOpen}
      form={orderForm}
      busy={busy}
      inventoryItems={inventoryItems}
      onSetFormOpen={onSetOrderOpen}
      onSetForm={onSetOrderForm}
      onAdd={onAddOrder}
      onDelete={onDeleteOrder}
      onQuickRepeat={onQuickRepeatOrder}
    />
  )
}
