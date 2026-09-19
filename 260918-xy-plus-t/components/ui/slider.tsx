import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "cn"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  // Base UI's default of 10 is absolute, which overshoots any range narrower than 0–100
  largeStep = (max - min) / 10,
  ...props
}: SliderPrimitive.Root.Props) {
  const _values = Array.isArray(value)
    ? value
    : typeof value === "number"
      ? [value]
      : Array.isArray(defaultValue)
        ? defaultValue
        : [min, max]

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      largeStep={largeStep}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex h-5 w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden bg-border select-none data-horizontal:h-px data-horizontal:w-full data-vertical:h-full data-vertical:w-px"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-foreground/60 select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            // the thumbs' inputs are what assistive tech focuses, so they carry the name too
            aria-label={
              props["aria-label"] &&
              (_values.length > 1 ? `${props["aria-label"]} ${index ? "end" : "start"}` : props["aria-label"])
            }
            className="relative block size-2 shrink-0 rounded-full bg-foreground ring-foreground/15 transition-[box-shadow,transform] select-none after:absolute after:-inset-3 hover:scale-125 hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden active:ring-4 disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
