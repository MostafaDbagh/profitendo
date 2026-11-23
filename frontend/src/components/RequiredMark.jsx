// Native required / aria-required provides the accessible requirement; the
// asterisk is its consistent visual cue in both writing directions.
export default function RequiredMark({required=true}) {
 return required?<span aria-hidden="true" className="ms-1 text-red-600" data-required-mark="true">*</span>:null;
}
