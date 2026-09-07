import { CommandGroup, CommandItem } from '@/components/ui/command'
import { useCommandPalette } from '../command-context'

// Feature pages own workflow actions, including permissions and confirmation.
export function ContextGroup() {
  const { contextActions, setOpen } = useCommandPalette()
  if (contextActions.length === 0) return null

  return (
    <CommandGroup heading="Ações desta página">
      {contextActions.map((action) => (
        <CommandItem
          key={action.id}
          value={action.id}
          keywords={[action.label, ...(action.keywords ?? [])]}
          onSelect={() => {
            setOpen(false)
            action.onSelect()
          }}
        >
          {action.icon}
          <span>{action.label}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
